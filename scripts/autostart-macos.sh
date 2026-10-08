#!/usr/bin/env bash
#
# Bring the ToDoList stack up when the user logs in.
#
# Invoked by the LaunchAgent installed by scripts/install-autostart-macos.sh.
# Containers already carry `restart: unless-stopped`, so this only has to cope
# with the one case that policy cannot: the Docker daemon itself not running
# yet (Docker Desktop has AutoStart disabled on this machine).
#
# Safe to run by hand at any time.
set -uo pipefail

REPO="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
WAIT_SECONDS="${TODOLIST_AUTOSTART_WAIT:-300}"

log() { printf '[todolist-autostart] %s\n' "$*"; }

# --- 1. make sure the Docker daemon is up -----------------------------------
if ! docker info >/dev/null 2>&1; then
  log "Docker daemon is not running; launching Docker Desktop"
  open -a Docker >/dev/null 2>&1 || log "WARNING: could not open Docker Desktop"
fi

deadline=$(( SECONDS + WAIT_SECONDS ))
until docker info >/dev/null 2>&1; do
  if [ "${SECONDS}" -ge "${deadline}" ]; then
    log "ERROR: Docker daemon did not come up within ${WAIT_SECONDS}s"
    exit 1
  fi
  sleep 5
done
log "Docker daemon is up"

# --- 2. bring the stack up --------------------------------------------------
cd "${REPO}" || { log "ERROR: cannot cd to ${REPO}"; exit 1; }

if ! docker compose up -d --wait 2>/dev/null; then
  # `--wait` needs a recent compose; fall back to a plain up.
  docker compose up -d || { log "ERROR: docker compose up failed"; exit 1; }
fi
log "stack started"

# --- 3. report --------------------------------------------------------------
docker compose ps --format '{{.Service}}  {{.Status}}' 2>/dev/null | while read -r line; do
  log "  ${line}"
done

if ! curl -fsS --max-time 10 http://127.0.0.1:8001/api/v1/health/ >/dev/null 2>&1; then
  log "WARNING: health check did not answer yet (it may still be starting)"
fi
