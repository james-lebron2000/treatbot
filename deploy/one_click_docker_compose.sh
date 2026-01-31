#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)

MODE="local" # local | relay
AUTOSSH_ENV_FILE=""
SETUP_RELAY=0
START_TUNNEL=0
SMOKE=0
NO_BUILD=0

usage() {
  cat <<'EOF'
Usage:
  ./deploy/one_click_docker_compose.sh [--relay] [--tunnel] [--autossh-env FILE] [--setup-relay] [--smoke] [--no-build]

Modes:
  (default)         Start docker-compose locally (frontend+backend+ocr+mongo+redis).
  --relay           Start with docker-compose relay overrides (publish backend/ocr ports for reverse tunnels).

Options:
  --tunnel          After services are healthy, run tunnel preflight + start autossh (requires an autossh env file).
  --autossh-env     Path to autossh env file (default: ./deploy/autossh.env if exists).
  --setup-relay     (First time only) Sync and setup relay Nginx config on remote.
  --smoke           Run an API smoke check through frontend proxy (register -> parse -> streaming match).
  --no-build        Skip image build (faster when images already built).

Examples:
  ./deploy/one_click_docker_compose.sh
  ./deploy/one_click_docker_compose.sh --smoke
  ./deploy/one_click_docker_compose.sh --relay --tunnel --autossh-env ./deploy/autossh.root.relay.env
EOF
}

log() { printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"; }
die() { echo "ERROR: $*" >&2; exit 1; }

ensure_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "Required command not found: $1"
}

choose_frontend_port() {
  local port
  for port in 3000 3001 3002 3003 3004 3005; do
    if ! nc -z 127.0.0.1 "$port" >/dev/null 2>&1; then
      echo "$port"
      return 0
    fi
  done
  echo "0"
  return 0
}

wait_for_health() {
  local base="$1"
  log "Waiting for ${base}/api/health"
  for _ in $(seq 1 120); do
    if curl -fsS --max-time 2 "${base}/api/health" >/dev/null 2>&1; then
      log "OK: ${base}/api/health"
      return 0
    fi
    sleep 1
  done
  return 1
}

smoke_check() {
  local base="$1"
  log "Running smoke check through ${base}"

  local email pass name token parse_resp record_id start_resp job_id status_resp has_more matches_count

  email="smoke_dc_$(date +%s)@test.com"
  pass="Abcd1234X"
  name="SmokeDC"

  token="$(
    curl -fsS -X POST "${base}/api/auth/register" \
      -H 'Content-Type: application/json' \
      -d "{\"email\":\"${email}\",\"password\":\"${pass}\",\"name\":\"${name}\",\"acceptComplianceSecurityAgreement\":true}" \
      | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['token'])"
  )"

  local text_json
  text_json="$(python3 - <<'PY'
import json
text=open('test_medical_record.txt','r',encoding='utf-8').read()
print(json.dumps(text))
PY
)"

  local use_llm_flag="${SMOKE_USE_LLM:-}"
  if [[ -z "${use_llm_flag}" ]]; then
    if [[ "${STRICT_MODE:-}" == "true" ]]; then
      use_llm_flag="true"
    else
      use_llm_flag="false"
    fi
  fi

  parse_resp="$(curl -fsS -X POST "${base}/api/medical/parse" \
    -H 'Content-Type: application/json' \
    -H "Authorization: Bearer ${token}" \
    -d "{\"text\":${text_json},\"useLLM\":${use_llm_flag}}")"

  record_id="$(python3 - <<PY
import json
p=json.loads('''$parse_resp''')["data"]
print(p.get("recordId") or "")
PY
)"
  [[ -n "${record_id}" ]] || die "Smoke: missing recordId from /api/medical/parse"

  start_resp="$(curl -fsS -X POST "${base}/api/medical/match/${record_id}/start" \
    -H 'Content-Type: application/json' \
    -H "Authorization: Bearer ${token}" \
    -d "{\"batchSize\":20,\"restart\":true,\"filters\":{\"statuses\":[\"recruiting\",\"active\"]}}")"

  job_id="$(python3 - <<PY
import json
p=json.loads('''$start_resp''')["data"]
print(p.get("jobId") or "")
PY
)"
  [[ -n "${job_id}" ]] || die "Smoke: missing jobId from /api/medical/match/:recordId/start"

  local sse_tmp
  sse_tmp="$(mktemp)"
  curl -fsS -N "${base}/api/medical/match/${record_id}/stream?jobId=${job_id}&token=${token}" --max-time 3 >"$sse_tmp" 2>/dev/null || true
  if ! grep -q "event: initial" "$sse_tmp"; then
    cat "$sse_tmp" || true
    rm -f "$sse_tmp"
    die "Smoke: did not receive initial SSE event"
  fi
  rm -f "$sse_tmp"

  local done=0
  local status_tmp
  status_tmp="$(mktemp)"
  for _ in $(seq 1 240); do
    curl -fsS "${base}/api/medical/match/${record_id}/status" -H "Authorization: Bearer ${token}" >"$status_tmp"
    has_more="$(python3 - <<PY
import json
p=json.load(open("$status_tmp","r",encoding="utf-8")).get("data") or {}
md=p.get("metadata") or {}
print("1" if md.get("hasMore") else "0")
PY
)"
    if [[ "${has_more}" == "0" ]]; then
      done=1
      break
    fi
    sleep 0.5
  done

  if [[ "$done" != "1" ]]; then
    cat "$status_tmp" | head -c 800 || true
    rm -f "$status_tmp"
    die "Smoke: timed out waiting for streaming job to complete"
  fi

  matches_count="$(python3 - <<PY
import json
p=json.load(open("$status_tmp","r",encoding="utf-8")).get("data") or {}
matches=p.get("matches") or []
print(len(matches))
PY
)"
  rm -f "$status_tmp"

  if [[ "${matches_count}" -lt 1 ]]; then
    die "Smoke: completed, but no matches returned"
  fi

  log "Smoke OK: recordId=${record_id} matches=${matches_count}"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help) usage; exit 0 ;;
    --relay) MODE="relay" ;;
    --tunnel) START_TUNNEL=1 ;;
    --autossh-env) AUTOSSH_ENV_FILE="${2:-}"; shift ;;
    --setup-relay) SETUP_RELAY=1 ;;
    --smoke) SMOKE=1 ;;
    --no-build) NO_BUILD=1 ;;
    *) die "Unknown argument: $1 (use --help)" ;;
  esac
  shift
done

ensure_cmd docker
ensure_cmd curl
ensure_cmd python3

if [[ -f "${ROOT_DIR}/.env" ]]; then
  # Load .env so flags like STRICT_MODE can influence smoke behavior.
  # shellcheck disable=SC1090
  set -a
  source "${ROOT_DIR}/.env"
  set +a
fi

if ! docker info >/dev/null 2>&1; then
  die "Docker daemon not reachable. On macOS: start Docker Desktop first."
fi

if [[ -z "${AUTOSSH_ENV_FILE}" ]]; then
  if [[ -f "${ROOT_DIR}/deploy/autossh.env" ]]; then
    AUTOSSH_ENV_FILE="${ROOT_DIR}/deploy/autossh.env"
  fi
fi

COMPOSE=(docker compose)
COMPOSE_FILES=(-f "${ROOT_DIR}/docker-compose.yml")

if [[ "${MODE}" == "relay" ]]; then
  COMPOSE_FILES+=(-f "${ROOT_DIR}/docker-compose.relay.yml")

  [[ -n "${AUTOSSH_ENV_FILE}" && -f "${AUTOSSH_ENV_FILE}" ]] || die "--relay requires an autossh env file. Provide --autossh-env or create ./deploy/autossh.env from ./deploy/autossh.docker-compose.env.example"
  # shellcheck disable=SC1090
  source "${AUTOSSH_ENV_FILE}"

  export FRONTEND_PORT="${LOCAL_FRONTEND_PORT:-3002}"
  export LOCAL_MEDICAL_PORT="${LOCAL_MEDICAL_PORT:-5002}"
  export LOCAL_OCR_PORT="${LOCAL_OCR_PORT:-5003}"

  if nc -z 127.0.0.1 "${FRONTEND_PORT}" >/dev/null 2>&1; then
    die "FRONTEND_PORT=${FRONTEND_PORT} is already in use. Free the port or change LOCAL_FRONTEND_PORT in ${AUTOSSH_ENV_FILE}."
  fi
else
  if [[ -z "${FRONTEND_PORT:-}" ]]; then
    FRONTEND_PORT="$(choose_frontend_port)"
    [[ "${FRONTEND_PORT}" != "0" ]] || die "No free port found in 3000-3005 for frontend."
    export FRONTEND_PORT
  fi
fi

BASE="http://127.0.0.1:${FRONTEND_PORT}"

log "Starting docker-compose (${MODE}) with FRONTEND_PORT=${FRONTEND_PORT}"
if [[ "${NO_BUILD}" == "1" ]]; then
  "${COMPOSE[@]}" "${COMPOSE_FILES[@]}" up -d >/dev/null
else
  "${COMPOSE[@]}" "${COMPOSE_FILES[@]}" up -d --build >/dev/null
fi

if ! wait_for_health "${BASE}"; then
  "${COMPOSE[@]}" "${COMPOSE_FILES[@]}" ps || true
  die "Frontend proxy health check failed: ${BASE}/api/health"
fi

if [[ "${MODE}" == "relay" && "${SETUP_RELAY}" == "1" ]]; then
  # Map autossh env naming -> deploy scripts naming
  export REMOTE_USER="${REMOTE_USER:-${AUTOSSH_REMOTE_USER:-root}}"
  export REMOTE_HOST="${REMOTE_HOST:-${AUTOSSH_REMOTE_HOST:-167.179.111.87}}"
  export SSH_PORT="${SSH_PORT:-${AUTOSSH_SSH_PORT:-22}}"
  log "Syncing and setting up relay (${REMOTE_USER}@${REMOTE_HOST})"
  REMOTE_USER="${REMOTE_USER}" REMOTE_HOST="${REMOTE_HOST}" SSH_PORT="${SSH_PORT}" \
    "${ROOT_DIR}/deploy/relay/sync_and_setup.sh"
fi

if [[ "${MODE}" == "relay" && "${START_TUNNEL}" == "1" ]]; then
  log "Tunnel preflight"
  AUTOSSH_ENV_FILE="${AUTOSSH_ENV_FILE}" "${ROOT_DIR}/deploy/tunnel_preflight.sh"
  log "Starting autossh tunnel"
  AUTOSSH_ENV_FILE="${AUTOSSH_ENV_FILE}" "${ROOT_DIR}/deploy/autossh_manual.sh"
fi

if [[ "${SMOKE}" == "1" ]]; then
  smoke_check "${BASE}"
fi

log "Done. Open: ${BASE}"
