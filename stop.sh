#!/usr/bin/env bash
# Stop Bard Browser — this project's server only, never every vite on the machine.
cd "$(dirname "$0")"
PIDFILE=".bardbrowser.pid"

if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
  kill "$(cat "$PIDFILE")" && rm -f "$PIDFILE"
  echo "Bard Browser stopped."
  exit 0
fi

rm -f "$PIDFILE"
PORT="${BARD_BROWSER_PORT:-${MYRPG_PORT:-5173}}"
if curl -s -o /dev/null -X POST "http://localhost:$PORT/__quit"; then
  echo "Bard Browser stopped (via the running server on port $PORT)."
else
  echo "Bard Browser does not appear to be running."
fi
