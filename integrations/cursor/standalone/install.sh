#!/usr/bin/env bash
#
# Install the ToDoList Cursor MCP + skill from an extracted download package.
#
#   ./install.sh /path/to/your-project
#
# Optional env:
#   TODOLIST_API_URL   REST base URL (default: http://localhost:8001/api/v1)
#                      When the web UI is reached via :8081 / a tunnel, use
#                      http(s)://that-host/api/v1 instead of :8001.
#
# Idempotent. Never reads or writes a token.
set -euo pipefail

PACKAGE_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"

TARGET_ARG="${1:-}"
if [[ -z "${TARGET_ARG}" ]]; then
  printf 'usage: %s /path/to/your-project\n' "$(basename -- "$0")" >&2
  exit 1
fi
if [[ ! -d "${TARGET_ARG}" ]]; then
  printf 'error: target directory does not exist: %s\n' "${TARGET_ARG}" >&2
  exit 1
fi
TARGET="$(cd -- "${TARGET_ARG}" && pwd -P)"

SKILL_SRC="${PACKAGE_ROOT}/skills/todolist-plan"
SKILL_DST="${TARGET}/.cursor/skills/todolist-plan"
MCP_JSON="${TARGET}/.cursor/mcp.json"
ENV_FILE="${HOME}/.config/todolist/mcp.env"
API_URL="${TODOLIST_API_URL:-http://localhost:8001/api/v1}"
MCP_DIR="${PACKAGE_ROOT}/mcp"
VENV_DIR="${PACKAGE_ROOT}/.venv"
VENV_PY="${VENV_DIR}/bin/python"
REQUIREMENTS="${MCP_DIR}/requirements.txt"

if [[ ! -f "${SKILL_SRC}/SKILL.md" ]]; then
  printf 'error: skill missing: %s\n' "${SKILL_SRC}/SKILL.md" >&2
  exit 1
fi
if [[ ! -d "${MCP_DIR}/todolist_mcp" ]]; then
  printf 'error: MCP server missing: %s/todolist_mcp\n' "${MCP_DIR}" >&2
  exit 1
fi
if [[ ! -f "${REQUIREMENTS}" ]]; then
  printf 'error: requirements missing: %s\n' "${REQUIREMENTS}" >&2
  exit 1
fi

if ! command -v python3 >/dev/null 2>&1; then
  printf 'error: python3 is required (3.10+)\n' >&2
  exit 1
fi

# --- 1. venv + mcp SDK ------------------------------------------------------
if [[ ! -x "${VENV_PY}" ]]; then
  printf 'creating venv -> %s\n' "${VENV_DIR}"
  python3 -m venv "${VENV_DIR}"
fi
printf 'installing mcp SDK into venv…\n'
"${VENV_DIR}/bin/pip" install --upgrade pip >/dev/null
"${VENV_DIR}/bin/pip" install -r "${REQUIREMENTS}"
COMMAND="${VENV_PY}"

# --- 2. skill ---------------------------------------------------------------
mkdir -p "${SKILL_DST}"
cp -f "${SKILL_SRC}/SKILL.md" "${SKILL_DST}/SKILL.md"
printf 'installed skill  -> %s\n' "${SKILL_DST}/SKILL.md"

# --- 3. mcp.json (merge, never clobber other servers) -----------------------
mkdir -p "$(dirname -- "${MCP_JSON}")"
mkdir -p "$(dirname -- "${ENV_FILE}")" 2>/dev/null || true

PACKAGE_ROOT="${PACKAGE_ROOT}" MCP_JSON="${MCP_JSON}" COMMAND="${COMMAND}" \
MCP_DIR="${MCP_DIR}" API_URL="${API_URL}" ENV_FILE="${ENV_FILE}" \
"${COMMAND}" - <<'PY'
import json
import os
import sys

path = os.environ["MCP_JSON"]

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

servers["todolist"] = {
    "command": os.environ["COMMAND"],
    "args": ["-m", "todolist_mcp"],
    "env": {
        "PYTHONPATH": os.environ["MCP_DIR"],
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
printf 'API URL           -> %s\n' "${API_URL}"

cat <<EOF

Next steps
----------
1. Create a personal token in ToDoList: Settings → API Tokens
   (plaintext is shown only once).
2. Write it to:

     ${ENV_FILE}

   as:

     TODOLIST_TOKEN=tdl_your_token_here

   chmod 600 that file. Do not commit it.
3. In Cursor: Reload Window (or toggle Settings → MCP → todolist).
4. Ask Cursor: 「我有哪些工作区」— it should call list_workspaces.

EOF
