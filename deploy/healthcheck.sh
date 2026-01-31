#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)

LOCAL_BASE=${LOCAL_BASE:-http://localhost}
REMOTE_BASE=${REMOTE_BASE:-https://findclinicaltrial.org}

LOCAL_FRONTEND_PORT=${LOCAL_FRONTEND_PORT:-${FRONTEND_PORT:-3000}}
LOCAL_OCR_PORT=${LOCAL_OCR_PORT:-5001}
LOCAL_MEDICAL_PORT=${LOCAL_MEDICAL_PORT:-5002}

declare -a checks=(
  "${LOCAL_BASE}:${LOCAL_FRONTEND_PORT}" \
  "${LOCAL_BASE}:${LOCAL_OCR_PORT}/health" \
  "${LOCAL_BASE}:${LOCAL_MEDICAL_PORT}/api/health" \
  "${REMOTE_BASE}" \
  "${REMOTE_BASE}/api/health" \
  "${REMOTE_BASE}/ocr/health"
)

fail=false
for url in "${checks[@]}"; do
  if curl --silent --fail --max-time 5 "$url" >/dev/null; then
    printf '[OK]   %s\n' "$url"
  else
    printf '[FAIL] %s\n' "$url"
    fail=true
  fi
done

if [[ "$fail" == true ]]; then
  exit 1
fi

printf 'All health checks passed.\n'
