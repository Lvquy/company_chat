#!/usr/bin/env bash

set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${ENV_FILE:-.env.production}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
BACKEND_SERVICE="${BACKEND_SERVICE:-backend}"
WAIT_TIMEOUT_SECONDS="${WAIT_TIMEOUT_SECONDS:-180}"
PULL_LATEST="${PULL_LATEST:-0}"
RUN_SEED="${RUN_SEED:-0}"

cd "$ROOT_DIR"

compose() {
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"
}

log() {
  printf '\n[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"
}

fail() {
  log "ERROR: $*"
  exit 1
}

require_file() {
  local path="$1"
  [[ -f "$path" ]] || fail "Không tìm thấy file: $path"
}

get_container_id() {
  compose ps -q "$BACKEND_SERVICE"
}

get_container_state() {
  local container_id="$1"
  docker inspect -f '{{.State.Status}}' "$container_id" 2>/dev/null || true
}

wait_for_backend() {
  local started_at now elapsed container_id state
  started_at="$(date +%s)"

  while true; do
    container_id="$(get_container_id)"
    if [[ -n "$container_id" ]]; then
      state="$(get_container_state "$container_id")"
      if [[ "$state" == "running" ]]; then
        log "Backend đã ở trạng thái running."
        return 0
      fi
      if [[ "$state" == "exited" || "$state" == "dead" ]]; then
        compose logs --tail=120 "$BACKEND_SERVICE" || true
        fail "Backend đã dừng với trạng thái: $state"
      fi
    fi

    now="$(date +%s)"
    elapsed="$((now - started_at))"
    if (( elapsed >= WAIT_TIMEOUT_SECONDS )); then
      compose ps || true
      compose logs --tail=120 "$BACKEND_SERVICE" || true
      fail "Hết thời gian chờ backend khởi động (${WAIT_TIMEOUT_SECONDS}s)"
    fi

    sleep 3
  done
}

require_file "$ENV_FILE"
require_file "$COMPOSE_FILE"

if [[ "$PULL_LATEST" == "1" ]]; then
  log "Đang git pull..."
  git pull --ff-only
fi

log "Đang build và khởi động lại stack..."
compose up -d --build

log "Đang chờ backend sẵn sàng..."
wait_for_backend

log "Đang chạy Prisma migrate deploy..."
compose exec "$BACKEND_SERVICE" pnpm prisma migrate deploy

if [[ "$RUN_SEED" == "1" ]]; then
  log "Đang chạy seed..."
  compose exec "$BACKEND_SERVICE" pnpm seed
fi

log "Trạng thái hiện tại của stack:"
compose ps

log "Deploy hoàn tất."
