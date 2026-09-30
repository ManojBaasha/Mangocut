#!/usr/bin/env bash
# One-time installer: LaunchAgent outside Documents (TCC-safe) that starts
# Mangocut AI when the agent touches script/triggers/start-ai-desktop.request
set -euo pipefail

ROOT="/Users/manojelango/Documents/Code/OpenCut"
LABEL="dev.jonam.mangocut.ai-desktop"
SUPPORT="$HOME/Library/Application Support/Mangocut"
WATCHER="$SUPPORT/ai-desktop-watcher.sh"
PLIST="$HOME/Library/LaunchAgents/${LABEL}.plist"
TRIG_DIR="$ROOT/script/triggers"
BUN_BIN="${HOME}/.bun/bin/bun"

if [[ ! -x "$BUN_BIN" ]]; then
  BUN_BIN="$(command -v bun || true)"
fi
if [[ -z "${BUN_BIN}" || ! -x "$BUN_BIN" ]]; then
  echo "bun not found at ~/.bun/bin/bun — install bun first" >&2
  exit 1
fi

mkdir -p "$TRIG_DIR" "$SUPPORT" "$HOME/Library/LaunchAgents"

cat > "$WATCHER" <<WATCH
#!/bin/bash
set -euo pipefail
ROOT="${ROOT}"
TRIG="\$ROOT/script/triggers/start-ai-desktop.request"
LOG="\$ROOT/script/triggers/start-ai-desktop.log"
LOCK_PID="\$ROOT/script/triggers/dev-ai.pid"
BUN_BIN="${BUN_BIN}"
export PATH="\$(dirname "\$BUN_BIN"):\$ROOT/node_modules/.bin:/usr/bin:/bin:/usr/sbin:/sbin"
ulimit -n 65536 || true
unset ELECTRON_RUN_AS_NODE

log() { echo "[\$(date '+%Y-%m-%d %H:%M:%S')] \$*" | tee -a "\$LOG"; }

[[ -f "\$TRIG" ]] || exit 0
rm -f "\$TRIG"
log "Trigger received — starting bun run dev:ai"

if [[ -f "\$LOCK_PID" ]]; then
  old="\$(cat "\$LOCK_PID" || true)"
  if [[ -n "\${old:-}" ]] && kill -0 "\$old" 2>/dev/null; then
    log "Stopping previous pid \$old"
    kill "\$old" 2>/dev/null || true
    sleep 1
    kill -9 "\$old" 2>/dev/null || true
  fi
  rm -f "\$LOCK_PID"
fi

PORT="\${MANGOCUT_AI_PORT:-3045}"
if command -v lsof >/dev/null; then
  for pid in \$(lsof -tiTCP:"\$PORT" -sTCP:LISTEN 2>/dev/null || true); do
    log "Freeing :\$PORT pid \$pid"
    kill -9 "\$pid" 2>/dev/null || true
  done
fi

cd "\$ROOT"
nohup "\$BUN_BIN" run dev:ai >>"\$LOG" 2>&1 &
echo \$! >"\$LOCK_PID"
log "Started dev:ai pid \$(cat "\$LOCK_PID")"
WATCH

chmod +x "$WATCHER"
xattr -d com.apple.quarantine "$WATCHER" 2>/dev/null || true

# Keep a repo-side copy for reference/editing
cp "$WATCHER" "$ROOT/script/ai-desktop-watcher.sh"
chmod +x "$ROOT/script/ai-desktop-watcher.sh"

cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>${WATCHER}</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>$(dirname "$BUN_BIN"):/usr/bin:/bin:/usr/sbin:/sbin</string>
    <key>HOME</key>
    <string>${HOME}</string>
  </dict>
  <key>WatchPaths</key>
  <array>
    <string>${TRIG_DIR}</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${ROOT}</string>
  <key>RunAtLoad</key>
  <false/>
  <key>ThrottleInterval</key>
  <integer>2</integer>
  <key>StandardOutPath</key>
  <string>${TRIG_DIR}/watcher.stdout.log</string>
  <key>StandardErrorPath</key>
  <string>${TRIG_DIR}/watcher.stderr.log</string>
</dict>
</plist>
EOF

launchctl bootout "gui/$(id -u)/${LABEL}" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
launchctl enable "gui/$(id -u)/${LABEL}" 2>/dev/null || true

# Smoke-test execute permission for launchd path
/bin/bash "$WATCHER" && true

echo "Installed ${LABEL}"
echo "Watcher binary: ${WATCHER}"
echo "Agent trigger:  touch ${TRIG_DIR}/start-ai-desktop.request"
echo "Or from agent:  bun run dev:ai:request"
echo "Logs:           tail -f ${TRIG_DIR}/start-ai-desktop.log"
