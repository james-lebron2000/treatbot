#!/usr/bin/env bash
set -euo pipefail

PORT="${PORT:-5066}"
APP_MODE="${APP_MODE:-mock}"
MONGODB_URI="${MONGODB_URI:-mongodb://127.0.0.1:27017/clinicalmatch_smoke}"
JWT_SECRET="${JWT_SECRET:-smoke-secret}"
SMOKE_ENABLE_LLM="${SMOKE_ENABLE_LLM:-0}"
BASE="http://127.0.0.1:${PORT}"
LOG_DIR="${LOG_DIR:-./logs}"
LOG="${LOG_DIR}/smoke_phase0_phase1_${PORT}.log"

mkdir -p "$LOG_DIR"

STARTED_MONGO=0
if ! nc -z 127.0.0.1 27017 >/dev/null 2>&1; then
  if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
    echo "MongoDB not detected on 127.0.0.1:27017; starting via docker compose..."
    docker compose up -d mongodb >/dev/null
    STARTED_MONGO=1
    for _ in $(seq 1 60); do
      if nc -z 127.0.0.1 27017 >/dev/null 2>&1; then
        break
      fi
      sleep 0.5
    done
  else
    echo "MongoDB not detected and docker compose unavailable. Start MongoDB locally then re-run."
    exit 1
  fi
fi

echo "Starting server on ${BASE} (APP_MODE=${APP_MODE})"
if [ "$SMOKE_ENABLE_LLM" -eq 1 ]; then
  echo "SMOKE_ENABLE_LLM=1 (LLM calls may occur)"
  APP_MODE="$APP_MODE" PORT="$PORT" MONGODB_URI="$MONGODB_URI" JWT_SECRET="$JWT_SECRET" node server/index.js >"$LOG" 2>&1 &
else
  echo "SMOKE_ENABLE_LLM=0 (forcing OPENAI_API_KEY empty to avoid external calls)"
  APP_MODE="$APP_MODE" PORT="$PORT" MONGODB_URI="$MONGODB_URI" JWT_SECRET="$JWT_SECRET" OPENAI_API_KEY="" node server/index.js >"$LOG" 2>&1 &
fi
PID="$!"

cleanup() {
  kill "$PID" >/dev/null 2>&1 || true
  if [ "$STARTED_MONGO" -eq 1 ]; then
    docker compose stop mongodb >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

for _ in $(seq 1 40); do
  if curl -fsS "${BASE}/api/health" >/dev/null 2>&1; then
    break
  fi
  sleep 0.5
done

echo "Health:"
curl -fsS "${BASE}/api/health"
echo

EMAIL="smoke_$(date +%s)@test.com"
PASS="Abcd1234X"
NAME="Smoke"

TOKEN="$(
  curl -fsS -X POST "${BASE}/api/auth/register" \
    -H 'Content-Type: application/json' \
    -d "{\"email\":\"${EMAIL}\",\"password\":\"${PASS}\",\"name\":\"${NAME}\",\"acceptComplianceSecurityAgreement\":true}" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['token'])"
)"

echo "Registered user: ${EMAIL}"

echo "Trials locations (top 3 provinces/cities):"
curl -fsS "${BASE}/api/trials/locations" -H "Authorization: Bearer ${TOKEN}" \
  | python3 -c "import sys,json; p=json.load(sys.stdin)['data']; print('totals=', p['totals']); print('provincesTop3=', p['provinces'][:3]); print('citiesTop3=', p['cities'][:3])"

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

echo "Parse document classification:"
python3 - <<PY
import json
p=json.loads('''$PARSE''')['data']
dc=p.get('documentClassification') or {}
print('primaryType=', dc.get('primaryType'), 'confidence=', dc.get('confidence'))
PY

STRUCTURED="$(python3 - <<PY
import json
p=json.loads('''$PARSE''')["data"]
print(json.dumps(p.get("structuredData") or {}))
PY
)"

echo "Match (classic, geo province=上海市):"
curl -fsS -X POST "${BASE}/api/medical/match" \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer ${TOKEN}" \
  -d "{\"record\":${STRUCTURED},\"filters\":{\"geo\":{\"mode\":\"province\",\"provinces\":[\"上海市\"]}}}" \
  | python3 -c "import sys,json; p=json.load(sys.stdin)['data']; pref=p['provider']['prefilter']; print('matchesReturned=', len(p['matches'])); print('afterLocation=', pref.get('afterLocation')); print('topIntents=', p['provider'].get('trialRequirements',{}).get('topIntents',[])[:6])"

echo "Match (enhanced, geo province=上海市, hybrid=false):"
curl -fsS -X POST "${BASE}/api/medical/match/enhanced" \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer ${TOKEN}" \
  -d "{\"structuredData\":${STRUCTURED},\"useHybridMatching\":false,\"filters\":{\"geo\":{\"mode\":\"province\",\"provinces\":[\"上海市\"]}}}" \
  | python3 -c "import sys,json; p=json.load(sys.stdin)['data']; md=p.get('metadata',{}); print('matchesReturned=', len(p['matches'])); print('provider=', md.get('provider')); print('totalTrials=', md.get('totalTrials'))"

echo "Match batch (single batch):"
curl -fsS -X POST "${BASE}/api/medical/match/${RECORD_ID}/batch" \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer ${TOKEN}" \
  -d "{\"restart\":true,\"batchSize\":20,\"filters\":{\"statuses\":[\"recruiting\",\"active\"]}}" \
  | python3 -c "import sys,json; p=json.load(sys.stdin)['data']; b=p.get('batch',{}); print('batchNumber=', b.get('number'), 'hasMore=', b.get('hasMore')); print('matchesReturned=', len(p.get('matches') or []))"

echo "Match batch status:"
curl -fsS "${BASE}/api/medical/match/${RECORD_ID}/status" \
  -H "Authorization: Bearer ${TOKEN}" \
  | python3 -c "import sys,json; p=json.load(sys.stdin)['data']; s=p.get('session'); print('hasSession=', bool(s)); print('completed=', (s or {}).get('completed'))"

echo "Match streaming job start:"
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

echo "Match streaming job stream (expect 'event: initial'; token passed via query):"
STREAM_TMP="$(mktemp)"
curl -fsS -N "${BASE}/api/medical/match/${RECORD_ID}/stream?jobId=${JOB_ID}&token=${TOKEN}" --max-time 3 >"$STREAM_TMP" 2>/dev/null || true
if ! rg -q "event: initial" "$STREAM_TMP"; then
  echo "Did not receive initial SSE event"
  cat "$STREAM_TMP" || true
  exit 1
fi
rm -f "$STREAM_TMP"

echo "Match streaming job completion (poll status until hasMore=false):"
FINAL_STATUS="$(mktemp)"
DONE=0
for _ in $(seq 1 160); do
  curl -fsS "${BASE}/api/medical/match/${RECORD_ID}/status" -H "Authorization: Bearer ${TOKEN}" >"$FINAL_STATUS"
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
  sleep 0.25
done
if [ "$DONE" -ne 1 ]; then
  echo "Timed out waiting for streaming job to complete (hasMore still true)"
  cat "$FINAL_STATUS" | head -c 600 || true
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
MATCHES_OUT="${LOG_DIR}/smoke_matches_${PORT}.json"
cp "$FINAL_STATUS" "$MATCHES_OUT"
echo "Saved final match payload: ${MATCHES_OUT}"
rm -f "$FINAL_STATUS"

echo "Match (llm endpoint; expect rule-engine skip if baseline OK):"
curl -fsS -X POST "${BASE}/api/medical/match/llm" \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer ${TOKEN}" \
  -d "{\"record\":${STRUCTURED},\"filters\":{\"statuses\":[\"recruiting\"]}}" \
  | python3 -c "import sys,json; r=json.load(sys.stdin); p=r['data']; print('matchesReturned=', len(p['matches'])); print('provider=', p.get('provider',{}).get('provider')); print('baselineTopScore=', p.get('provider',{}).get('baseline',{}).get('topScore'))"

echo "Smoke test OK. Server log: ${LOG}"
