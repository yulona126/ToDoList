#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# ToDoList — end-to-end acceptance test.
#
# Drives the *running* stack through the whole product flow exactly as the
# browser would (same origin, through Nginx), and asserts the results.
#
#   ./scripts/e2e.sh                 # against http://localhost:8081
#   BASE_URL=http://host ./scripts/e2e.sh
#
# Exit code 0 = every assertion passed.
# ---------------------------------------------------------------------------
set -uo pipefail

cd "$(dirname "$0")/.."

if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi

BASE_URL="${BASE_URL:-http://localhost:${WEB_PORT:-8081}}"
API="${BASE_URL}/api/v1"

TMP="$(mktemp -d)"
trap 'rm -rf "${TMP}"' EXIT

PASS=0
FAIL=0

c_green() { printf '\033[32m%s\033[0m' "$1"; }
c_red()   { printf '\033[31m%s\033[0m' "$1"; }
c_dim()   { printf '\033[2m%s\033[0m' "$1"; }

ok() {
  PASS=$((PASS + 1))
  printf '  %s %s\n' "$(c_green '✓')" "$1"
}

ko() {
  FAIL=$((FAIL + 1))
  printf '  %s %s\n' "$(c_red '✗')" "$1"
  if [ -n "${2:-}" ]; then printf '      %s\n' "$(c_dim "$2")"; fi
}

section() { printf '\n%s\n' "$(c_dim "── $1 ─────────────────────────────────")"; }

# --- helpers ----------------------------------------------------------------

# http METHOD PATH [curl args...] -> writes body to $TMP/body, echoes status code
http() {
  local method="$1" path="$2"; shift 2
  curl -sS -o "${TMP}/body" -w '%{http_code}' -X "${method}" "${path}" "$@" 2>"${TMP}/curl.err" \
    || { printf '000'; return; }
}

# json <dotted.path>  (reads $TMP/body)
json() {
  python3 -c '
import json, sys
with open(sys.argv[1]) as fh:
    data = json.load(fh)
for part in sys.argv[2].split("."):
    if part == "":
        continue
    data = data[int(part)] if part.lstrip("-").isdigit() else data[part]
print(data)
' "${TMP}/body" "$1" 2>/dev/null
}

body_head() { head -c 300 "${TMP}/body" 2>/dev/null; }

expect_status() {
  local expected="$1" actual="$2" label="$3"
  if [ "${actual}" = "${expected}" ]; then
    ok "${label} (HTTP ${actual})"
  else
    ko "${label} — expected HTTP ${expected}, got ${actual}" "$(body_head)"
  fi
}

expect_eq() {
  local expected="$1" actual="$2" label="$3"
  if [ "${expected}" = "${actual}" ]; then
    ok "${label}"
  else
    ko "${label} — expected '${expected}', got '${actual}'" "$(body_head)"
  fi
}

STAMP="$(date +%s)"
USER_A="e2e-a-${STAMP}@example.com"
USER_B="e2e-b-${STAMP}@example.com"
PASSWORD="E2eSuperSecret123"

printf '\nToDoList end-to-end acceptance test\n'
printf 'target: %s\n' "${BASE_URL}"

# --- 0. the stack is reachable ---------------------------------------------
section "0. availability"

code="$(http GET "${API}/health/")"
expect_status 200 "${code}" "GET /health/"
if [ "${code}" = "200" ]; then
  expect_eq "ok" "$(json status)" "health.status == ok"
  expect_eq "ok" "$(json db)" "health.db == ok"
fi

code="$(http GET "${BASE_URL}/")"
expect_status 200 "${code}" "SPA index.html is served"

code="$(http GET "${BASE_URL}/manifest.webmanifest")"
expect_status 200 "${code}" "PWA manifest is served"

code="$(http GET "${BASE_URL}/sw.js")"
expect_status 200 "${code}" "service worker is served"

code="$(http GET "${BASE_URL}/api/docs/")"
expect_status 200 "${code}" "OpenAPI docs are served"

# --- 1. registration & login ------------------------------------------------
section "1. authentication"

code="$(http POST "${API}/auth/register/" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"${USER_A}\",\"username\":\"userA${STAMP}\",\"password\":\"${PASSWORD}\",\"password_confirm\":\"${PASSWORD}\"}")"
expect_status 201 "${code}" "register user A"

TOKEN_A="$(json access)"
REFRESH_A="$(json refresh)"
[ -n "${TOKEN_A}" ] && ok "register returned an access token" || ko "register returned no access token"

code="$(http POST "${API}/auth/register/" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"${USER_A}\",\"username\":\"dup${STAMP}\",\"password\":\"${PASSWORD}\",\"password_confirm\":\"${PASSWORD}\"}")"
expect_status 400 "${code}" "duplicate email is rejected"

code="$(http POST "${API}/auth/login/" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"${USER_A}\",\"password\":\"${PASSWORD}\"}")"
expect_status 200 "${code}" "login user A"

code="$(http POST "${API}/auth/login/" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"${USER_A}\",\"password\":\"wrong-password\"}")"
expect_status 401 "${code}" "wrong password is rejected"

code="$(http GET "${API}/workspaces/")"
expect_status 401 "${code}" "anonymous access is rejected"

AUTH_A=(-H "Authorization: Bearer ${TOKEN_A}")

code="$(http GET "${API}/auth/me/" "${AUTH_A[@]}")"
expect_status 200 "${code}" "GET /auth/me/ with bearer token"

# --- 2. workspace -----------------------------------------------------------
section "2. workspace"

code="$(http POST "${API}/workspaces/" "${AUTH_A[@]}" \
  -H 'Content-Type: application/json' \
  -d '{"name":"E2E 验收项目","description":"端到端脚本创建"}')"
expect_status 201 "${code}" "create workspace"

WS_ID="$(json id)"
expect_eq "owner" "$(json role)" "creator role == owner"
expect_eq "0" "$(json stats.total)" "new workspace starts empty"

code="$(http GET "${API}/workspaces/${WS_ID}/members/" "${AUTH_A[@]}")"
expect_status 200 "${code}" "list workspace members"
expect_eq "1" "$(json count)" "V1 membership contains only the owner"

# --- 3. list & tag ----------------------------------------------------------
section "3. list & tag"

code="$(http POST "${API}/lists/" "${AUTH_A[@]}" \
  -H 'Content-Type: application/json' \
  -d "{\"workspace\":${WS_ID},\"name\":\"开发\"}")"
expect_status 201 "${code}" "create list"
LIST_ID="$(json id)"

code="$(http POST "${API}/tags/" "${AUTH_A[@]}" \
  -H 'Content-Type: application/json' \
  -d "{\"workspace\":${WS_ID},\"name\":\"pwa\"}")"
expect_status 201 "${code}" "create tag"
TAG_ID="$(json id)"

code="$(http POST "${API}/tags/" "${AUTH_A[@]}" \
  -H 'Content-Type: application/json' \
  -d "{\"workspace\":${WS_ID},\"name\":\"pwa\"}")"
expect_status 400 "${code}" "duplicate tag in the same workspace is rejected"

# --- 4. tasks ---------------------------------------------------------------
section "4. tasks"

code="$(http POST "${API}/tasks/" "${AUTH_A[@]}" \
  -H 'Content-Type: application/json' \
  -d "{\"workspace\":${WS_ID},\"task_list\":${LIST_ID},\"title\":\"实现 Service Worker 缓存\",\"description\":\"NetworkFirst 3s\",\"status\":\"doing\",\"priority\":\"urgent\",\"task_type\":\"dev\",\"due_date\":\"$(date -v+3d +%Y-%m-%d 2>/dev/null || date -d '+3 days' +%Y-%m-%d)\",\"tag_ids\":[${TAG_ID}]}")"
expect_status 201 "${code}" "create task with tag"
TASK_ID="$(json id)"
expect_eq "urgent" "$(json priority)" "priority persisted"
expect_eq "pwa" "$(json tags.0.name)" "tag attached"

code="$(http POST "${API}/tasks/" "${AUTH_A[@]}" \
  -H 'Content-Type: application/json' \
  -d "{\"workspace\":${WS_ID},\"task_list\":${LIST_ID},\"parent\":${TASK_ID},\"title\":\"子任务：兜底回退\"}")"
expect_status 201 "${code}" "create subtask"
SUBTASK_ID="$(json id)"

code="$(http POST "${API}/tasks/" "${AUTH_A[@]}" \
  -H 'Content-Type: application/json' \
  -d "{\"workspace\":${WS_ID},\"parent\":${SUBTASK_ID},\"title\":\"三层嵌套\"}")"
expect_status 400 "${code}" "third level of nesting is rejected"

code="$(http GET "${API}/tasks/${TASK_ID}/" "${AUTH_A[@]}")"
expect_eq "1" "$(json subtask_stats.total)" "parent reports 1 subtask"

code="$(http POST "${API}/tasks/${SUBTASK_ID}/toggle/" "${AUTH_A[@]}")"
expect_status 200 "${code}" "toggle subtask"
expect_eq "done" "$(json status)" "toggle set status=done"

code="$(http GET "${API}/tasks/${SUBTASK_ID}/" "${AUTH_A[@]}")"
[ "$(json completed_at)" != "None" ] && ok "completed_at was stamped automatically" \
  || ko "completed_at was not stamped"

code="$(http GET "${API}/tasks/?workspace=${WS_ID}&status=doing" "${AUTH_A[@]}")"
expect_eq "1" "$(json count)" "filter by status=doing"

code="$(http GET "${API}/tasks/?workspace=${WS_ID}&tag=${TAG_ID}" "${AUTH_A[@]}")"
expect_eq "1" "$(json count)" "filter by tag"

code="$(http GET "${API}/tasks/?workspace=${WS_ID}&search=Service" "${AUTH_A[@]}")"
expect_eq "1" "$(json count)" "full-text-ish search"

code="$(http GET "${API}/tasks/?workspace=${WS_ID}" "${AUTH_A[@]}")"
expect_eq "1" "$(json results.0.subtask_stats.done)" "subtask progress is aggregated"

code="$(http GET "${API}/workspaces/" "${AUTH_A[@]}")"
expect_eq "2" "$(json results.0.stats.total)" "workspace stats reflect the new tasks"

# --- 5. update / reorder / bulk --------------------------------------------
section "5. update, reorder, bulk"

code="$(http PATCH "${API}/tasks/${TASK_ID}/" "${AUTH_A[@]}" \
  -H 'Content-Type: application/json' \
  -d '{"priority":"low","status":"todo"}')"
expect_status 200 "${code}" "patch task"
expect_eq "low" "$(json priority)" "priority updated"

code="$(http POST "${API}/tasks/reorder/" "${AUTH_A[@]}" \
  -H 'Content-Type: application/json' \
  -d "{\"items\":[{\"id\":${TASK_ID},\"sort_order\":7}]}")"
expect_status 200 "${code}" "reorder tasks"

code="$(http POST "${API}/tasks/bulk/" "${AUTH_A[@]}" \
  -H 'Content-Type: application/json' \
  -d "{\"ids\":[${TASK_ID}],\"action\":\"done\"}")"
expect_status 200 "${code}" "bulk mark done"
expect_eq "1" "$(json updated)" "bulk reported 1 update"

# --- 6. cross-user isolation ------------------------------------------------
section "6. isolation"

code="$(http POST "${API}/auth/register/" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"${USER_B}\",\"username\":\"userB${STAMP}\",\"password\":\"${PASSWORD}\",\"password_confirm\":\"${PASSWORD}\"}")"
expect_status 201 "${code}" "register user B"
TOKEN_B="$(json access)"
AUTH_B=(-H "Authorization: Bearer ${TOKEN_B}")

code="$(http GET "${API}/workspaces/" "${AUTH_B[@]}")"
expect_eq "0" "$(json count)" "user B sees no workspaces"

code="$(http GET "${API}/workspaces/${WS_ID}/" "${AUTH_B[@]}")"
expect_status 404 "${code}" "user B cannot read user A's workspace"

code="$(http GET "${API}/tasks/${TASK_ID}/" "${AUTH_B[@]}")"
expect_status 404 "${code}" "user B cannot read user A's task"

code="$(http PATCH "${API}/tasks/${TASK_ID}/" "${AUTH_B[@]}" \
  -H 'Content-Type: application/json' -d '{"title":"hacked"}')"
expect_status 404 "${code}" "user B cannot modify user A's task"

code="$(http GET "${API}/tasks/?workspace=${WS_ID}" "${AUTH_B[@]}")"
expect_eq "0" "$(json count)" "user B's task query over A's workspace is empty"

# --- 7. token lifecycle -----------------------------------------------------
section "7. token lifecycle"

code="$(http POST "${API}/auth/refresh/" \
  -H 'Content-Type: application/json' -d "{\"refresh\":\"${REFRESH_A}\"}")"
expect_status 200 "${code}" "refresh access token"

code="$(http POST "${API}/auth/logout/" "${AUTH_A[@]}" \
  -H 'Content-Type: application/json' -d "{\"refresh\":\"${REFRESH_A}\"}")"
expect_status 205 "${code}" "logout blacklists the refresh token"

code="$(http POST "${API}/auth/refresh/" \
  -H 'Content-Type: application/json' -d "{\"refresh\":\"${REFRESH_A}\"}")"
expect_status 401 "${code}" "blacklisted refresh token is rejected"

# --- cleanup ----------------------------------------------------------------
section "cleanup"
if docker compose ps --status running --services 2>/dev/null | grep -qx backend; then
  docker compose exec -T backend python manage.py shell -c "
from django.contrib.auth import get_user_model
User = get_user_model()
deleted = User.objects.filter(email__in=['${USER_A}', '${USER_B}']).delete()
print('removed e2e users:', deleted[0])
" >/dev/null 2>&1 && ok "e2e users removed" || ko "could not remove e2e users (harmless)"
else
  printf '  %s\n' "$(c_dim '· backend container not running, skipping cleanup')"
fi

# --- summary ----------------------------------------------------------------
printf '\n────────────────────────────────────────────\n'
printf 'passed: %s   failed: %s\n' "$(c_green "${PASS}")" "$(c_red "${FAIL}")"
if [ "${FAIL}" -eq 0 ]; then
  printf '%s\n\n' "$(c_green 'E2E RESULT: ALL GREEN')"
  exit 0
fi
printf '%s\n\n' "$(c_red 'E2E RESULT: FAILURES PRESENT')"
exit 1
