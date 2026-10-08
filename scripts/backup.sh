#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Dump the ToDoList database to ./backups/ using pg_dump inside the db
# container. Safe to run while the stack is up.
#
#   ./scripts/backup.sh
# ---------------------------------------------------------------------------
set -euo pipefail

cd "$(dirname "$0")/.."

# Load .env if present so the credentials match the running stack.
if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi

DB_USER="${POSTGRES_USER:-todolist}"
DB_NAME="${POSTGRES_DB:-todolist}"
STAMP="$(date +%Y%m%d-%H%M%S)"
OUT_DIR="backups"
OUT_FILE="${OUT_DIR}/${DB_NAME}-${STAMP}.dump"

mkdir -p "${OUT_DIR}"

if ! docker compose ps --status running --services | grep -qx db; then
  echo "error: the 'db' service is not running. Start the stack first." >&2
  exit 1
fi

echo "dumping ${DB_NAME} → ${OUT_FILE}"
docker compose exec -T db pg_dump -U "${DB_USER}" -d "${DB_NAME}" --format=custom > "${OUT_FILE}"

echo "done: ${OUT_FILE} ($(du -h "${OUT_FILE}" | cut -f1))"
