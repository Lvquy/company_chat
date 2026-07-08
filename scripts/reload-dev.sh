#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="$ROOT_DIR/.dev-logs"

mkdir -p "$LOG_DIR"

kill_port() {
  local port="$1"
  local pids

  pids="$(lsof -ti :"$port" || true)"
  if [[ -n "$pids" ]]; then
    echo "Stopping processes on port $port: $pids"
    kill $pids || true
    sleep 1
  fi
}

echo "Reloading inhouse-chat-suite..."

kill_port 3000
kill_port 3001

rm -rf "$ROOT_DIR/apps/admin/.next"

(
  cd "$ROOT_DIR"
  docker compose up -d
)

BACKEND_LOG="$LOG_DIR/backend.log"
FRONTEND_LOG="$LOG_DIR/admin.log"

: > "$BACKEND_LOG"
: > "$FRONTEND_LOG"

(
  cd "$ROOT_DIR"
  nohup pnpm dev:backend >"$BACKEND_LOG" 2>&1 &
  echo $! > "$LOG_DIR/backend.pid"
)

(
  cd "$ROOT_DIR"
  nohup pnpm dev:admin >"$FRONTEND_LOG" 2>&1 &
  echo $! > "$LOG_DIR/admin.pid"
)

sleep 2

echo "Reload complete."
echo "Web:     http://localhost:3000"
echo "Backend: http://localhost:3001"
echo "Logs:"
echo "  $BACKEND_LOG"
echo "  $FRONTEND_LOG"
