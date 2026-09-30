#!/bin/bash
set -euo pipefail
ROOT="/Users/manojelango/Documents/Code/OpenCut"
TRIG="$ROOT/script/triggers/start-ai-desktop.request"
LOG="$ROOT/script/triggers/start-ai-desktop.log"
LOCK_PID="$ROOT/script/triggers/dev-ai.pid"
BUN_BIN="/Users/manojelango/.nvm/versions/node/v22.18.0/bin/bun"
export PATH="$(dirname "$BUN_BIN"):$ROOT/node_modules/.bin:/usr/bin:/bin:/usr/sbin:/sbin"
ulimit -n 65536 || true
unset ELECTRON_RUN_AS_NODE

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG"; }

[[ -f "$TRIG" ]] || exit 0
rm -f "$TRIG"
log "Trigger received — starting bun run dev:ai"

if [[ -f "$LOCK_PID" ]]; then
  old="$(cat "$LOCK_PID" || true)"
  if [[ -n "${old:-}" ]] && kill -0 "$old" 2>/dev/null; then
    log "Stopping previous pid $old"
    kill "$old" 2>/dev/null || true
    sleep 1
    kill -9 "$old" 2>/dev/null || true
  fi
  rm -f "$LOCK_PID"
fi

PORT="${MANGOCUT_AI_PORT:-3045}"
if command -v lsof >/dev/null; then
  for pid in $(lsof -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null || true); do
    log "Freeing :$PORT pid $pid"
    kill -9 "$pid" 2>/dev/null || true
  done
fi

cd "$ROOT"
nohup "$BUN_BIN" run dev:ai >>"$LOG" 2>&1 &
echo $! >"$LOCK_PID"
log "Started dev:ai pid $(cat "$LOCK_PID")"
