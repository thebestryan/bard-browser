#!/usr/bin/env bash
# Bard Browser launcher — installs dependencies if missing, then serves the app.
set -e
cd "$(dirname "$0")"

# BARD_BROWSER_PORT is the current name; MYRPG_PORT still works for old aliases.
PORT="${BARD_BROWSER_PORT:-${MYRPG_PORT:-5173}}"
PIDFILE=".bardbrowser.pid"

if [ ! -d node_modules ]; then
  echo "Installing dependencies (first run only)…"
  npm install
fi

echo "Starting Bard Browser on http://localhost:$PORT"
# Run vite directly, NOT via `npm run` — npm would be the child we track while
# the real server runs one level deeper and survives being killed.
./node_modules/.bin/vite --port "$PORT" --strictPort &
VITE_PID=$!
echo "$VITE_PID" > "$PIDFILE"

shutdown() {
  trap - INT TERM EXIT
  kill "$VITE_PID" 2>/dev/null || true
  wait "$VITE_PID" 2>/dev/null || true
  rm -f "$PIDFILE"
  echo "Bard Browser stopped."
}
trap shutdown INT TERM EXIT

# Wait for the server, then open the browser
for _ in $(seq 1 30); do
  if curl -s -o /dev/null "http://localhost:$PORT"; then break; fi
  sleep 0.5
done

URL="http://localhost:$PORT"
if command -v xdg-open > /dev/null; then xdg-open "$URL" >/dev/null 2>&1
elif command -v open > /dev/null; then open "$URL"
else echo "Open $URL in your browser."
fi

echo "Bard Browser is running at $URL"
echo "Stop it with Ctrl+C, ./stop.sh, or the Quit button in the sidebar."
wait "$VITE_PID"
