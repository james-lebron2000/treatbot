#!/usr/bin/env bash
set -euo pipefail

DEFAULT_FRONTEND_PORT="${FRONTEND_PORT:-3000}"
BASE_IS_SET="${BASE+x}"
BASE_FROM_ENV="${BASE-}"
if [ -n "${BASE_IS_SET}" ]; then
  BASE="${BASE_FROM_ENV}"
else
  BASE="http://127.0.0.1:${DEFAULT_FRONTEND_PORT}"
fi
LOG_DIR="${LOG_DIR:-./logs}"
OUT_JSON="${OUT_JSON:-${LOG_DIR}/smoke_docker_compose_matches.json}"

mkdir -p "$LOG_DIR"

if ! command -v docker >/dev/null 2>&1; then
  echo "docker not found"
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  echo "Docker daemon not reachable."
  echo "On macOS: start Docker Desktop first, then re-run."
  exit 1
fi

echo "Starting docker compose services (if not already running)..."
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

if [ -z "${FRONTEND_PORT:-}" ] && [ -z "${BASE_IS_SET}" ] && [[ "${BASE}" == "http://127.0.0.1:${DEFAULT_FRONTEND_PORT}" ]]; then
  if nc -z 127.0.0.1 "${DEFAULT_FRONTEND_PORT}" >/dev/null 2>&1; then
    CHOSEN_PORT="$(choose_frontend_port)"
    if [ "$CHOSEN_PORT" = "0" ]; then
      echo "No free port found in 3000-3005 for frontend."
      exit 1
    fi
    export FRONTEND_PORT="$CHOSEN_PORT"
    BASE="http://127.0.0.1:${FRONTEND_PORT}"
    echo "Port ${DEFAULT_FRONTEND_PORT} is in use; using FRONTEND_PORT=${FRONTEND_PORT} for docker-compose."
  fi
fi

FRONTEND_PORT="${FRONTEND_PORT:-$DEFAULT_FRONTEND_PORT}" docker compose up -d --build >/dev/null

echo "Waiting for frontend /api/health via proxy: ${BASE}/api/health"
for _ in $(seq 1 120); do
  if curl -fsS "${BASE}/api/health" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

echo "Health:"
curl -fsS "${BASE}/api/health"
echo

EMAIL="smoke_dc_$(date +%s)@test.com"
PASS="Abcd1234X"
NAME="SmokeDC"

TOKEN="$(
  curl -fsS -X POST "${BASE}/api/auth/register" \
    -H 'Content-Type: application/json' \
    -d "{\"email\":\"${EMAIL}\",\"password\":\"${PASS}\",\"name\":\"${NAME}\",\"acceptComplianceSecurityAgreement\":true}" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['token'])"
)"

echo "Registered user: ${EMAIL}"

TEXT_JSON="$(python3 - <<'PY'
import json
text=open('test_medical_record.txt','r',encoding='utf-8').read()
print(json.dumps(text))
PY
)"

PARSE="$(curl -fsS -X POST "${BASE}/api/medical/parse" \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer ${TOKEN}" \
  -d "{\"text\":${TEXT_JSON},\"useLLM\":false}")"

RECORD_ID="$(python3 - <<PY
import json
p=json.loads('''$PARSE''')["data"]
print(p.get("recordId") or "")
PY
)"
if [ -z "$RECORD_ID" ]; then
  echo "Missing recordId from parse response"
  exit 1
fi
echo "recordId=${RECORD_ID}"

echo "Start streaming match job (statuses=recruiting|active):"
START_JOB="$(curl -fsS -X POST "${BASE}/api/medical/match/${RECORD_ID}/start" \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer ${TOKEN}" \
  -d "{\"batchSize\":20,\"restart\":true,\"filters\":{\"statuses\":[\"recruiting\",\"active\"]}}")"
JOB_ID="$(python3 - <<PY
import json
p=json.loads('''$START_JOB''')["data"]
print(p.get("jobId") or "")
PY
)"
if [ -z "$JOB_ID" ]; then
  echo "Missing jobId from start response"
  exit 1
fi
echo "jobId=${JOB_ID}"

echo "Verify SSE stream through Next proxy (expect 'event: initial')"
STREAM_TMP="$(mktemp)"
curl -fsS -N "${BASE}/api/medical/match/${RECORD_ID}/stream?jobId=${JOB_ID}&token=${TOKEN}" --max-time 3 >"$STREAM_TMP" 2>/dev/null || true
if ! rg -q "event: initial" "$STREAM_TMP"; then
  echo "Did not receive initial SSE event"
  cat "$STREAM_TMP" || true
  exit 1
fi
rm -f "$STREAM_TMP"

echo "Wait for completion (poll /status until hasMore=false)"
FINAL_STATUS="$(mktemp)"
DONE=0
for _ in $(seq 1 240); do
  curl -fsS "${BASE}/api/medical/match/${RECORD_ID}/status" \
    -H "Authorization: Bearer ${TOKEN}" >"$FINAL_STATUS"
  HAS_MORE="$(python3 - <<PY
import json
p=json.load(open("$FINAL_STATUS","r",encoding="utf-8")).get("data") or {}
md=p.get("metadata") or {}
print("1" if md.get("hasMore") else "0")
PY
)"
  if [ "$HAS_MORE" = "0" ]; then
    DONE=1
    break
  fi
  sleep 0.5
done
if [ "$DONE" -ne 1 ]; then
  echo "Timed out waiting for streaming job to complete"
  cat "$FINAL_STATUS" | head -c 800 || true
  rm -f "$FINAL_STATUS"
  exit 1
fi

python3 - <<PY
import json
p=json.load(open("$FINAL_STATUS","r",encoding="utf-8"))["data"]
md=p.get("metadata") or {}
matches=p.get("matches") or []
print("hasMore=", md.get("hasMore"))
print("matchedTrials=", len(matches))
print("statusFilter=", (md.get("matchFilters") or {}).get("statuses"))
PY

cp "$FINAL_STATUS" "$OUT_JSON"
rm -f "$FINAL_STATUS"

echo "Saved final match payload: ${OUT_JSON}"
echo "Smoke OK (docker-compose path)."
