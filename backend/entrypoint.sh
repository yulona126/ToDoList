#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Backend container entrypoint.
#
#   1. wait for PostgreSQL
#   2. apply migrations
#   3. collect static files (served by Nginx / WhiteNoise)
#   4. optionally bootstrap an admin account
#   5. exec the CMD (gunicorn)
# ---------------------------------------------------------------------------
set -euo pipefail

log() { printf '[entrypoint] %s\n' "$*"; }

: "${POSTGRES_HOST:=db}"
: "${POSTGRES_PORT:=5432}"
: "${POSTGRES_USER:=todolist}"
: "${POSTGRES_DB:=todolist}"
: "${DB_WAIT_RETRIES:=30}"
: "${DB_WAIT_INTERVAL:=2}"

# -- 1. database -------------------------------------------------------------
log "waiting for PostgreSQL at ${POSTGRES_HOST}:${POSTGRES_PORT} ..."
attempt=1
until pg_isready -h "${POSTGRES_HOST}" -p "${POSTGRES_PORT}" -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" >/dev/null 2>&1; do
  if [ "${attempt}" -ge "${DB_WAIT_RETRIES}" ]; then
    log "ERROR: database not reachable after $((DB_WAIT_RETRIES * DB_WAIT_INTERVAL))s"
    exit 1
  fi
  attempt=$((attempt + 1))
  sleep "${DB_WAIT_INTERVAL}"
done
log "database is up."

# -- 2. migrations -----------------------------------------------------------
log "applying migrations ..."
python manage.py migrate --noinput

# -- 3. static files ---------------------------------------------------------
log "collecting static files ..."
python manage.py collectstatic --noinput --clear >/dev/null

# -- 4. optional superuser ---------------------------------------------------
if [ -n "${DJANGO_SUPERUSER_EMAIL:-}" ] && [ -n "${DJANGO_SUPERUSER_PASSWORD:-}" ]; then
  log "ensuring superuser ${DJANGO_SUPERUSER_EMAIL} exists ..."
  python manage.py createsuperuser --noinput \
    --email "${DJANGO_SUPERUSER_EMAIL}" \
    --username "${DJANGO_SUPERUSER_USERNAME:-admin}" 2>/dev/null || true
fi

# -- warnings ----------------------------------------------------------------
if [ -z "${DJANGO_SECRET_KEY:-}" ]; then
  log "WARNING: DJANGO_SECRET_KEY is not set — an insecure development key is in use."
  log "WARNING: set DJANGO_SECRET_KEY in .env before exposing this instance."
fi
if [ "${DJANGO_DEBUG:-false}" = "true" ]; then
  log "WARNING: DJANGO_DEBUG=true — never use this in production."
fi

# -- 5. run ------------------------------------------------------------------
log "starting: $*"
exec "$@"
