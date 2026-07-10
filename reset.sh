#!/usr/bin/env bash

set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${ENV_FILE:-.env.production}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
PULL_LATEST="${PULL_LATEST:-0}"
RUN_SEED="${RUN_SEED:-0}"
PRUNE_VOLUMES="${PRUNE_VOLUMES:-1}"
PRUNE_GLOBAL_DOCKER="${PRUNE_GLOBAL_DOCKER:-1}"

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

require_file "$ENV_FILE"
require_file "$COMPOSE_FILE"
require_file "$ROOT_DIR/deploy.sh"

if [[ "$PULL_LATEST" == "1" ]]; then
  log "Đang git pull..."
  git pull --ff-only
fi

log "Đang dừng và xóa stack hiện tại..."
if [[ "$PRUNE_VOLUMES" == "1" ]]; then
  compose down --volumes --remove-orphans
else
  compose down --remove-orphans
fi

log "Đang xóa image build nội bộ của project..."
docker image rm company_chat-admin company_chat-backend 2>/dev/null || true

if [[ "$PRUNE_GLOBAL_DOCKER" == "1" ]]; then
  log "Đang dọn build cache / image / volume Docker không dùng..."
  docker builder prune -af || true
  docker system prune -af || true
  docker volume prune -f || true
fi

log "Đang deploy lại sạch từ đầu..."
PULL_LATEST=0 RUN_SEED="$RUN_SEED" ENV_FILE="$ENV_FILE" COMPOSE_FILE="$COMPOSE_FILE" "$ROOT_DIR/deploy.sh"

log "Reset hoàn tất."
