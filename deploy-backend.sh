#!/usr/bin/env bash

set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${ENV_FILE:-.env.production}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
BACKEND_SERVICE="${BACKEND_SERVICE:-backend}"
WAIT_TIMEOUT_SECONDS="${WAIT_TIMEOUT_SECONDS:-180}"
PULL_LATEST="${PULL_LATEST:-0}"

cd "$ROOT_DIR"

compose() {
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"
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
        return 0
      fi
      if [[ "$state" == "exited" || "$state" == "dead" ]]; then
        compose logs --tail=120 "$BACKEND_SERVICE" || true
        exit 1
      fi
    fi

    now="$(date +%s)"
    elapsed="$((now - started_at))"
    if (( elapsed >= WAIT_TIMEOUT_SECONDS )); then
      compose ps || true
      compose logs --tail=120 "$BACKEND_SERVICE" || true
      exit 1
    fi

    sleep 3
  done
}

if [[ "$PULL_LATEST" == "1" ]]; then
  git pull --ff-only
fi

compose up -d --build backend
wait_for_backend
compose exec "$BACKEND_SERVICE" pnpm prisma migrate deploy
compose ps "$BACKEND_SERVICE"
