#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
AUTOSSH_ENV_FILE="${AUTOSSH_ENV_FILE:-${ROOT_DIR}/deploy/autossh.env}"

# Preserve explicit environment overrides (should win over autossh.env)
ENV_REMOTE_USER="${AUTOSSH_REMOTE_USER-}"
ENV_REMOTE_HOST="${AUTOSSH_REMOTE_HOST-}"
ENV_SSH_PORT="${AUTOSSH_SSH_PORT-}"
ENV_IDENTITY_FILE="${SSH_IDENTITY_FILE-}"
ENV_LOCAL_FRONTEND_PORT="${LOCAL_FRONTEND_PORT-}"
ENV_LOCAL_MEDICAL_PORT="${LOCAL_MEDICAL_PORT-}"
ENV_LOCAL_OCR_PORT="${LOCAL_OCR_PORT-}"

if [[ -f "${AUTOSSH_ENV_FILE}" ]]; then
  # shellcheck disable=SC1090
  source "${AUTOSSH_ENV_FILE}"
fi

if [[ -n "${ENV_REMOTE_USER}" ]]; then AUTOSSH_REMOTE_USER="${ENV_REMOTE_USER}"; fi
if [[ -n "${ENV_REMOTE_HOST}" ]]; then AUTOSSH_REMOTE_HOST="${ENV_REMOTE_HOST}"; fi
if [[ -n "${ENV_SSH_PORT}" ]]; then AUTOSSH_SSH_PORT="${ENV_SSH_PORT}"; fi
if [[ -n "${ENV_IDENTITY_FILE}" ]]; then SSH_IDENTITY_FILE="${ENV_IDENTITY_FILE}"; fi
if [[ -n "${ENV_LOCAL_FRONTEND_PORT}" ]]; then LOCAL_FRONTEND_PORT="${ENV_LOCAL_FRONTEND_PORT}"; fi
if [[ -n "${ENV_LOCAL_MEDICAL_PORT}" ]]; then LOCAL_MEDICAL_PORT="${ENV_LOCAL_MEDICAL_PORT}"; fi
if [[ -n "${ENV_LOCAL_OCR_PORT}" ]]; then LOCAL_OCR_PORT="${ENV_LOCAL_OCR_PORT}"; fi

REMOTE_USER="${AUTOSSH_REMOTE_USER:-${REMOTE_USER:-}}"
REMOTE_HOST="${AUTOSSH_REMOTE_HOST:-${REMOTE_HOST:-}}"
SSH_PORT="${AUTOSSH_SSH_PORT:-${SSH_PORT:-22}}"
IDENTITY_FILE="${SSH_IDENTITY_FILE:-${IDENTITY_FILE:-}}"

LOCAL_FRONTEND_PORT="${LOCAL_FRONTEND_PORT:-${FRONTEND_PORT:-3000}}"
LOCAL_MEDICAL_PORT="${LOCAL_MEDICAL_PORT:-5002}"
LOCAL_OCR_PORT="${LOCAL_OCR_PORT:-5001}"

echo "=== Tunnel preflight ==="
echo "local: frontend=${LOCAL_FRONTEND_PORT} medical=${LOCAL_MEDICAL_PORT} ocr=${LOCAL_OCR_PORT}"
echo "relay: user=${REMOTE_USER:-<unset>} host=${REMOTE_HOST:-<unset>} port=${SSH_PORT}"
echo

echo "[1] Local health checks"
curl -fsS --max-time 3 "http://127.0.0.1:${LOCAL_FRONTEND_PORT}/api/health" >/dev/null && echo "  OK frontend /api/health" || (echo "  FAIL frontend /api/health"; exit 1)
curl -fsS --max-time 3 "http://127.0.0.1:${LOCAL_MEDICAL_PORT}/api/health" >/dev/null && echo "  OK backend /api/health" || echo "  WARN backend /api/health (may be ok if only tunnelling frontend)"
curl -fsS --max-time 3 "http://127.0.0.1:${LOCAL_OCR_PORT}/health" >/dev/null && echo "  OK ocr /health" || echo "  WARN ocr /health (may be ok if not tunnelling /ocr)"
echo

if [[ -z "${REMOTE_HOST}" || -z "${REMOTE_USER}" ]]; then
  echo "[2] SSH check skipped (AUTOSSH_REMOTE_USER/HOST not set)"
  exit 0
fi

SSH_CMD=(ssh -p "${SSH_PORT}" -o StrictHostKeyChecking=no -o BatchMode=yes -o ConnectTimeout=8)

key_is_encrypted=0
if [[ -n "${IDENTITY_FILE}" && -f "${IDENTITY_FILE}" ]]; then
  if ! ssh-keygen -y -f "${IDENTITY_FILE}" </dev/null >/dev/null 2>&1; then
    key_is_encrypted=1
  fi
fi

if [[ "${key_is_encrypted}" == "1" ]]; then
  echo "[2] SSH key is encrypted: ${IDENTITY_FILE}"
  agent_out="$(ssh-add -l 2>&1 || true)"
  if echo "${agent_out}" | grep -qi 'could not open a connection to your authentication agent'; then
    echo "  FAIL: ssh-agent not available."
    echo "  Start an agent and add the key, then retry:"
    echo "    eval \"\$(ssh-agent -s)\""
    echo "    ssh-add \"${IDENTITY_FILE}\""
    exit 2
  fi
  if echo "${agent_out}" | grep -q 'The agent has no identities'; then
    echo "  FAIL: ssh-agent has no identities."
    echo "  Run this interactively once, then retry:"
    echo "    ssh-add \"${IDENTITY_FILE}\""
    exit 2
  fi

  # Avoid reading encrypted IdentityFile from ~/.ssh/config; rely on agent instead.
  SSH_CMD+=( -F /dev/null )
else
  if [[ -n "${IDENTITY_FILE}" ]]; then
    SSH_CMD+=(-i "${IDENTITY_FILE}" -o IdentitiesOnly=yes)
  fi
fi

echo "[2] SSH auth check (publickey, non-interactive)"
if "${SSH_CMD[@]}" "${REMOTE_USER}@${REMOTE_HOST}" "echo ok" >/dev/null 2>&1; then
  echo "  OK ssh auth"
else
  echo "  FAIL ssh auth"
  echo "  Next: ensure the public key is in ${REMOTE_USER}@${REMOTE_HOST}:~/.ssh/authorized_keys"
  exit 2
fi
