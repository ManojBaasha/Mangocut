#!/bin/bash
cd /Users/manojelango/Documents/Code/OpenCut
export PATH="$HOME/.bun/bin:$PATH"
ulimit -n 65536
unset ELECTRON_RUN_AS_NODE

echo "Stopping old Next.js / Electron leftovers..."
pkill -9 -f "next dev" 2>/dev/null || true
pkill -9 -f "next start" 2>/dev/null || true
pkill -9 -f "Electron.app" 2>/dev/null || true
sleep 1
rm -f apps/web/.next/dev/lock

PORT=3045
echo "Starting Mangocut web (prod) on http://127.0.0.1:${PORT} ..."
cd apps/web
bun run next start -p "$PORT" -H 127.0.0.1 &
WEB_PID=$!
cd ../..

for i in $(seq 1 40); do
  if curl -sf "http://127.0.0.1:${PORT}/api/health" >/dev/null; then
    echo "Web is up."
    break
  fi
  sleep 0.25
done

echo "Testing OpenRouter key..."
curl -sf -X POST "http://127.0.0.1:${PORT}/api/ai/chat" \
  -H 'Content-Type: application/json' \
  -d '{"model":"openai/gpt-4.1-mini","messages":[{"role":"user","content":"Reply with exactly: ok"}]}' \
  | head -c 200 || echo "(chat probe failed — check OPENROUTER_API_KEY)"
echo

echo "Launching Electron..."
MANGOCUT_DEV_URL="http://127.0.0.1:${PORT}" \
MANGOCUT_AI_ORIGIN="http://127.0.0.1:${PORT}" \
bun run --cwd apps/electron dev

kill "$WEB_PID" 2>/dev/null || true
