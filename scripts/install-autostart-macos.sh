#!/usr/bin/env bash
#
# Install (or remove) a macOS LaunchAgent that starts the ToDoList stack at login.
#
#   ./scripts/install-autostart-macos.sh            # install + load
#   ./scripts/install-autostart-macos.sh uninstall  # unload + remove
#
# Why this exists: the containers use `restart: unless-stopped`, but that only
# takes effect once the Docker daemon is running — and Docker Desktop has
# "Start Docker Desktop when you sign in" turned OFF on this machine. The agent
# starts Docker Desktop, waits for the daemon, then runs `docker compose up -d`.
set -euo pipefail

REPO="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
LABEL="dev.yulon.todolist"
WORKER="${REPO}/scripts/autostart-macos.sh"
PLIST="${HOME}/Library/LaunchAgents/${LABEL}.plist"
LOGDIR="${HOME}/Library/Logs"
DOMAIN="gui/$(id -u)"

if [[ ! -f "${WORKER}" ]]; then
  printf 'error: worker script not found: %s\n' "${WORKER}" >&2
  exit 1
fi

# --- uninstall --------------------------------------------------------------
if [[ "${1:-install}" == "uninstall" ]]; then
  launchctl bootout "${DOMAIN}/${LABEL}" 2>/dev/null || true
  rm -f "${PLIST}"
  printf 'removed %s\n' "${PLIST}"
  printf 'the stack keeps running; stop it with: cd %s && docker compose down\n' "${REPO}"
  exit 0
fi

# --- install ----------------------------------------------------------------
mkdir -p "$(dirname "${PLIST}")" "${LOGDIR}"
chmod +x "${WORKER}"

cat > "${PLIST}" <<PLIST_EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${LABEL}</string>
    <key>ProgramArguments</key>
    <array>
        <string>/bin/bash</string>
        <string>${WORKER}</string>
    </array>
    <!-- Run once at login. Not KeepAlive: the containers look after themselves
         via restart: unless-stopped, and we do not want a respawn loop if
         Docker is unhealthy. -->
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <false/>
    <key>StandardOutPath</key>
    <string>${LOGDIR}/todolist-autostart.log</string>
    <key>StandardErrorPath</key>
    <string>${LOGDIR}/todolist-autostart.err</string>
</dict>
</plist>
PLIST_EOF

# Reload cleanly whether or not it was already loaded.
launchctl bootout "${DOMAIN}/${LABEL}" 2>/dev/null || true
launchctl bootstrap "${DOMAIN}" "${PLIST}"
launchctl enable "${DOMAIN}/${LABEL}" 2>/dev/null || true

printf 'installed %s\n' "${PLIST}"
cat <<EOF

Next steps
----------
1. Test it now without rebooting:
     launchctl kickstart -k ${DOMAIN}/${LABEL}
     tail -f ${LOGDIR}/todolist-autostart.log

2. Confirm the containers will also survive on their own:
     docker inspect todolist-backend-1 --format '{{.HostConfig.RestartPolicy.Name}}'
   (expected: unless-stopped)

3. Log out and back in to verify the real path.

Logs:     ${LOGDIR}/todolist-autostart.log
Remove:   ${REPO}/scripts/install-autostart-macos.sh uninstall
EOF
