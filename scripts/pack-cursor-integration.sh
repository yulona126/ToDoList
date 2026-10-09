#!/usr/bin/env bash
#
# Build downloadable Cursor MCP + skill packages into frontend/public/downloads/
# so the Settings page can serve them from the same origin.
#
#   scripts/pack-cursor-integration.sh
#
# Outputs:
#   frontend/public/downloads/todolist-cursor-mcp.zip
#   frontend/public/downloads/todolist-cursor-skill.zip
#   frontend/public/downloads/manifest.json
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd -P)"

OUT_DIR="${REPO_ROOT}/frontend/public/downloads"
STAGE="$(mktemp -d "${TMPDIR:-/tmp}/todolist-cursor-pack.XXXXXX")"
cleanup() { rm -rf "${STAGE}"; }
trap cleanup EXIT

MCP_SRC="${REPO_ROOT}/mcp"
SKILL_SRC="${REPO_ROOT}/integrations/cursor/skills/todolist-plan"
STANDALONE="${REPO_ROOT}/integrations/cursor/standalone"

if [[ ! -d "${MCP_SRC}/todolist_mcp" ]]; then
  printf 'error: MCP source missing: %s/todolist_mcp\n' "${MCP_SRC}" >&2
  exit 1
fi
if [[ ! -f "${SKILL_SRC}/SKILL.md" ]]; then
  printf 'error: skill missing: %s\n' "${SKILL_SRC}/SKILL.md" >&2
  exit 1
fi
if [[ ! -f "${STANDALONE}/install.sh" ]]; then
  printf 'error: standalone installer missing: %s\n' "${STANDALONE}/install.sh" >&2
  exit 1
fi
if ! command -v zip >/dev/null 2>&1; then
  printf 'error: zip is required\n' >&2
  exit 1
fi

mkdir -p "${OUT_DIR}"

BUNDLE_NAME="todolist-cursor-mcp"
BUNDLE_ROOT="${STAGE}/${BUNDLE_NAME}"
mkdir -p "${BUNDLE_ROOT}/mcp" "${BUNDLE_ROOT}/skills"

# MCP server (source only — no .venv, no caches, no tests).
(
  cd "${MCP_SRC}"
  tar -cf - \
    --exclude='.venv' \
    --exclude='__pycache__' \
    --exclude='*.egg-info' \
    --exclude='.pytest_cache' \
    --exclude='.mypy_cache' \
    --exclude='.ruff_cache' \
    --exclude='tests' \
    . | tar -xf - -C "${BUNDLE_ROOT}/mcp"
)

cp -R "${SKILL_SRC}" "${BUNDLE_ROOT}/skills/todolist-plan"
cp "${STANDALONE}/install.sh" "${BUNDLE_ROOT}/install.sh"
cp "${STANDALONE}/README.md" "${BUNDLE_ROOT}/README.md"
cp "${REPO_ROOT}/integrations/cursor/mcp.env.example" "${BUNDLE_ROOT}/mcp.env.example"
chmod +x "${BUNDLE_ROOT}/install.sh"

# Full package.
(
  cd "${STAGE}"
  rm -f "${OUT_DIR}/${BUNDLE_NAME}.zip"
  zip -qr "${OUT_DIR}/${BUNDLE_NAME}.zip" "${BUNDLE_NAME}"
)

# Skill-only package.
SKILL_STAGE="${STAGE}/skill-only"
mkdir -p "${SKILL_STAGE}"
cp -R "${SKILL_SRC}" "${SKILL_STAGE}/todolist-plan"
(
  cd "${SKILL_STAGE}"
  rm -f "${OUT_DIR}/todolist-cursor-skill.zip"
  zip -qr "${OUT_DIR}/todolist-cursor-skill.zip" todolist-plan
)

VERSION="$(
  git -C "${REPO_ROOT}" describe --tags --always --dirty 2>/dev/null || echo "dev"
)"
BUILT_AT="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
MCP_BYTES="$(wc -c < "${OUT_DIR}/${BUNDLE_NAME}.zip" | tr -d ' ')"
SKILL_BYTES="$(wc -c < "${OUT_DIR}/todolist-cursor-skill.zip" | tr -d ' ')"

cat > "${OUT_DIR}/manifest.json" <<EOF
{
  "version": "${VERSION}",
  "built_at": "${BUILT_AT}",
  "packages": {
    "mcp": {
      "file": "${BUNDLE_NAME}.zip",
      "bytes": ${MCP_BYTES}
    },
    "skill": {
      "file": "todolist-cursor-skill.zip",
      "bytes": ${SKILL_BYTES}
    }
  }
}
EOF

printf 'wrote %s (%s bytes)\n' "${OUT_DIR}/${BUNDLE_NAME}.zip" "${MCP_BYTES}"
printf 'wrote %s (%s bytes)\n' "${OUT_DIR}/todolist-cursor-skill.zip" "${SKILL_BYTES}"
printf 'wrote %s\n' "${OUT_DIR}/manifest.json"
