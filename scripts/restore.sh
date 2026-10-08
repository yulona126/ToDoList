#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Restore a dump produced by scripts/backup.sh.
#
#   ./scripts/restore.sh backups/todolist-20260211-093000.dump
#
# WARNING: this DROPS and recreates the public schema. The stack may stay up,
# but every existing row in the target database is replaced.
# ---------------------------------------------------------------------------
set -euo pipefail

cd "$(dirname "$0")/.."

DUMP_FILE="${1:-}"
if [ -z "${DUMP_FILE}" ]; then
  echo "usage: $0 <path-to-.dump>" >&2
  exit 2
fi
if [ ! -f "${DUMP_FILE}" ]; then
  echo "error: ${DUMP_FILE} does not exist" >&2
  exit 2
fi

if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi

DB_USER="${POSTGRES_USER:-todolist}"
DB_NAME="${POSTGRES_DB:-todolist}"

echo "about to restore ${DUMP_FILE} into database '${DB_NAME}'."
read -r -p "Type 'yes' to continue: " CONFIRM
if [ "${CONFIRM}" != "yes" ]; then
  echo "aborted."
  exit 1
fi

echo "stopping the backend so no writes race the restore ..."
docker compose stop backend >/dev/null

echo "resetting schema ..."
docker compose exec -T db psql -U "${DB_USER}" -d "${DB_NAME}" \
  -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;" >/dev/null

echo "restoring ..."
docker compose exec -T db pg_restore -U "${DB_USER}" -d "${DB_NAME}" --no-owner --no-privileges < "${DUMP_FILE}"

echo "restarting the backend ..."
docker compose start backend >/dev/null

echo "done. Migrations will be re-applied on backend startup."
