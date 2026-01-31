#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)

log() { printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"; }
die() { echo "ERROR: $*" >&2; exit 1; }

ensure_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "Required command not found: $1"
}

ensure_cmd docker
ensure_cmd curl

if ! docker info >/dev/null 2>&1; then
  die "Docker daemon not reachable. On macOS: start Docker Desktop first."
fi

if [[ -z "${HOST_DATA_DIR:-}" ]]; then
  die "HOST_DATA_DIR is not set. Example: export HOST_DATA_DIR=\"$HOME/ClinicalMatchData\""
fi

log "Using HOST_DATA_DIR=${HOST_DATA_DIR}"

mkdir -p \
  "${HOST_DATA_DIR}/mongodb" \
  "${HOST_DATA_DIR}/redis" \
  "${HOST_DATA_DIR}/uploads"

log "Starting services (docker compose)..."
docker compose \
  -f "${ROOT_DIR}/docker-compose.yml" \
  -f "${ROOT_DIR}/docker-compose.macmini.yml" \
  up -d --build

log "Waiting for http://localhost:${FRONTEND_PORT:-3000}/api/health ..."
for _ in $(seq 1 120); do
  if curl -fsS --max-time 2 "http://localhost:${FRONTEND_PORT:-3000}/api/health" >/dev/null 2>&1; then
    log "OK: /api/health"
    break
  fi
  sleep 1
done

log "OK. Frontend should be available on http://localhost:${FRONTEND_PORT:-3000}"
log "Health check: http://localhost:${FRONTEND_PORT:-3000}/api/health"
