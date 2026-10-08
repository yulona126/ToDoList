#!/usr/bin/env bash
#
# Install the ToDoList Cursor integration into a project.
#
#   scripts/install-cursor-integration.sh [target-project-dir]
#
# Defaults to the current directory. Idempotent: re-running refreshes the skill
# and the `todolist` MCP server entry, and leaves every other `mcpServers`
# entry untouched. It never reads or writes a token.
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd -P)"

TARGET_ARG="${1:-.}"
if [[ ! -d "${TARGET_ARG}" ]]; then
  printf 'error: target directory does not exist: %s\n' "${TARGET_ARG}" >&2
  exit 1
fi
TARGET="$(cd -- "${TARGET_ARG}" && pwd -P)"

SKILL_SRC="${REPO_ROOT}/integrations/cursor/skills/todolist-plan"
SKILL_DST="${TARGET}/.cursor/skills/todolist-plan"
MCP_JSON="${TARGET}/.cursor/mcp.json"
ENV_FILE="${HOME}/.config/todolist/mcp.env"
API_URL="${TODOLIST_API_URL:-http://localhost:8001/api/v1}"

if [[ ! -f "${SKILL_SRC}/SKILL.md" ]]; then
  printf 'error: skill source not found: %s\n' "${SKILL_SRC}" >&2
  exit 1
fi

# --- pick an interpreter for the MCP server ---------------------------------
# Prefer the dedicated venv; fall back to `python3` with a warning, because a
# missing venv is the most common reason an MCP server silently fails to start.
VENV_PY="${REPO_ROOT}/mcp/.venv/bin/python"
VENV_OK=0
if [[ -x "${VENV_PY}" ]]; then
  COMMAND="${VENV_PY}"
  VENV_OK=1
else
  COMMAND="$(command -v python3 || true)"
  if [[ -z "${COMMAND}" ]]; then
    COMMAND="python3"
  fi
fi

# Any Python 3 can do the JSON merge; prefer the venv one.
MERGE_PY="${COMMAND}"

# --- 1. skill ---------------------------------------------------------------
mkdir -p "${SKILL_DST}"
cp -f "${SKILL_SRC}/SKILL.md" "${SKILL_DST}/SKILL.md"
printf 'installed skill  -> %s\n' "${SKILL_DST}/SKILL.md"

# --- 2. mcp.json (merge, never clobber) -------------------------------------
mkdir -p "$(dirname -- "${MCP_JSON}")"
# Convenience only: the env file may live in a directory we are not allowed to
# create, so never let this abort the install.
mkdir -p "$(dirname -- "${ENV_FILE}")" 2>/dev/null || true

REPO_ROOT="${REPO_ROOT}" MCP_JSON="${MCP_JSON}" COMMAND="${COMMAND}" \
API_URL="${API_URL}" ENV_FILE="${ENV_FILE}" "${MERGE_PY}" - <<'PY'
import json
import os
import sys

path = os.environ["MCP_JSON"]
repo = os.environ["REPO_ROOT"]

if os.path.exists(path):
    with open(path, encoding="utf-8") as handle:
        text = handle.read().strip()
    if not text:
        config = {}
    else:
        try:
            config = json.loads(text)
        except json.JSONDecodeError as exc:
            sys.stderr.write(
                f"error: {path} is not valid JSON ({exc}); refusing to overwrite it.\n"
            )
            raise SystemExit(2)
    if not isinstance(config, dict):
        sys.stderr.write(f"error: {path} must contain a JSON object.\n")
        raise SystemExit(2)
else:
    config = {}

servers = config.get("mcpServers")
if servers is None:
    servers = {}
elif not isinstance(servers, dict):
    sys.stderr.write(f'error: "mcpServers" in {path} must be a JSON object.\n')
    raise SystemExit(2)
config["mcpServers"] = servers

# Only our own entry is replaced; everything else is preserved verbatim.
servers["todolist"] = {
    "command": os.environ["COMMAND"],
    "args": ["-m", "todolist_mcp"],
    "env": {
        "PYTHONPATH": os.path.join(repo, "mcp"),
        "TODOLIST_API_URL": os.environ["API_URL"],
    },
    "envFile": os.environ["ENV_FILE"],
}

with open(path, "w", encoding="utf-8") as handle:
    json.dump(config, handle, indent=2, ensure_ascii=False)
    handle.write("\n")

print(f"parsed + wrote {path}: {len(servers)} server(s) configured")
PY

printf 'merged mcp config -> %s (server "todolist")\n' "${MCP_JSON}"

# --- 3. next steps ----------------------------------------------------------
if [[ "${VENV_OK}" -eq 0 ]]; then
  printf '\nwarning: %s not found.\n' "${VENV_PY}"
  printf '         create it first, then re-run this script so mcp.json points at it:\n'
  printf '           python3 -m venv "%s/mcp/.venv"\n' "${REPO_ROOT}"
  printf '           "%s/mcp/.venv/bin/pip" install "mcp==2.3.0"\n' "${REPO_ROOT}"
fi

cat <<EOF

Next steps
----------
1. Create a personal token in the ToDoList web UI: Settings -> API Tokens
   (the plaintext is shown only once).
2. Put it in the env file referenced by ${MCP_JSON}:

     ${ENV_FILE}

   with the content:

     TODOLIST_TOKEN=<paste-your-token-here>

   Keep that file out of version control (chmod 600 is a good idea).
   Alternative without an env file: replace the "envFile" key with
     "env": { ..., "TODOLIST_TOKEN": "\${env:TODOLIST_TOKEN}" }
   and export TODOLIST_TOKEN in the environment Cursor is launched from.
3. Reload Cursor (or toggle the server in Settings -> MCP) so it restarts the
   "todolist" server.
4. Verify: ask Cursor to "整理开发计划" — it should call list_workspaces.

Troubleshooting: if the server does not appear, check Cursor's MCP logs. A
missing TODOLIST_TOKEN still starts the server (a warning goes to stderr), but
every tool call then fails with a readable configuration error.
EOF
