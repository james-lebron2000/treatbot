#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
AUTOSSH_ENV_FILE="${AUTOSSH_ENV_FILE:-${ROOT_DIR}/deploy/autossh.env}"

if [[ -f "${AUTOSSH_ENV_FILE}" ]]; then
  # shellcheck disable=SC1090
  source "${AUTOSSH_ENV_FILE}"
fi

AUTOSSH_BIN="${AUTOSSH_BIN:-}"
if [[ -z "${AUTOSSH_BIN}" ]]; then
  AUTOSSH_BIN="$(command -v autossh 2>/dev/null || true)"
fi
AUTOSSH_BIN="${AUTOSSH_BIN:-/opt/homebrew/bin/autossh}"

REMOTE_USER="${REMOTE_USER:-${AUTOSSH_REMOTE_USER:-root}}"
REMOTE_HOST="${REMOTE_HOST:-${AUTOSSH_REMOTE_HOST:-167.179.111.87}}"
SSH_PORT="${SSH_PORT:-${AUTOSSH_SSH_PORT:-22}}"
IDENTITY_FILE="${SSH_IDENTITY_FILE:-${IDENTITY_FILE:-${HOME}/.ssh/id_rsa_clinical_trial}}"

FRONTEND_PORT="${LOCAL_FRONTEND_PORT:-3000}"
OCR_PORT="${LOCAL_OCR_PORT:-5001}"
MEDICAL_PORT="${LOCAL_MEDICAL_PORT:-5002}"
MATCH_PORT="${LOCAL_MATCH_PORT:-}"

REMOTE_FRONTEND_PORT="${REMOTE_FRONTEND_PORT:-8300}"
REMOTE_OCR_PORT="${REMOTE_OCR_PORT:-8501}"
REMOTE_MEDICAL_PORT="${REMOTE_MEDICAL_PORT:-8502}"
REMOTE_MATCH_PORT="${REMOTE_MATCH_PORT:-8503}"

LOG_DIR="${ROOT_DIR}/logs"
LOG_FILE="${LOG_DIR}/autossh-manual.log"
mkdir -p "${LOG_DIR}"

if ! command -v "${AUTOSSH_BIN}" >/dev/null 2>&1; then
  echo "autossh binary not found at ${AUTOSSH_BIN}. Install autossh and set AUTOSSH_BIN if needed." >&2
  exit 1
fi

pkill -f "${AUTOSSH_BIN} .* ${REMOTE_USER}@${REMOTE_HOST}" 2>/dev/null || true

KEY_IS_ENCRYPTED=0
if [[ -n "${IDENTITY_FILE}" && -f "${IDENTITY_FILE}" ]]; then
  if ! ssh-keygen -y -f "${IDENTITY_FILE}" </dev/null >/dev/null 2>&1; then
    KEY_IS_ENCRYPTED=1
  fi
fi

SSH_OPTS=(
  -M 0
  -o "ServerAliveInterval=30"
  -o "ServerAliveCountMax=3"
  -o "ExitOnForwardFailure=yes"
  -o "StrictHostKeyChecking=no"
  -o "TCPKeepAlive=yes"
  -N
  -R "${REMOTE_FRONTEND_PORT}":localhost:"${FRONTEND_PORT}"
  -R "${REMOTE_OCR_PORT}":localhost:"${OCR_PORT}"
  -R "${REMOTE_MEDICAL_PORT}":localhost:"${MEDICAL_PORT}"
  -p "${SSH_PORT}"
)

if [[ -n "${MATCH_PORT}" ]]; then
  SSH_OPTS+=( -R "${REMOTE_MATCH_PORT}":localhost:"${MATCH_PORT}" )
fi

if [[ "${KEY_IS_ENCRYPTED}" == "1" ]]; then
  agent_out="$(ssh-add -l 2>&1 || true)"
  if echo "${agent_out}" | grep -qi 'could not open a connection to your authentication agent'; then
    echo "Encrypted SSH key detected but ssh-agent not available." >&2
    echo "Start an agent and add the key, then re-run:" >&2
    echo "  eval \"\$(ssh-agent -s)\"" >&2
    echo "  ssh-add \"${IDENTITY_FILE}\"" >&2
    exit 2
  fi
  if echo "${agent_out}" | grep -q 'The agent has no identities'; then
    echo "Encrypted SSH key detected but ssh-agent has no identities." >&2
    echo "Run interactively once, then re-run this script:" >&2
    echo "  ssh-add \"${IDENTITY_FILE}\"" >&2
    exit 2
  fi
  # Avoid reading encrypted IdentityFile from ~/.ssh/config; rely on agent instead.
  SSH_OPTS+=( -F /dev/null )
else
  SSH_OPTS+=( -i "${IDENTITY_FILE}" )
fi

CMD=("${AUTOSSH_BIN}" "${SSH_OPTS[@]}" "${REMOTE_USER}@${REMOTE_HOST}")

echo "Launching autossh tunnel to ${REMOTE_USER}@${REMOTE_HOST} (ports: ${REMOTE_FRONTEND_PORT}→${FRONTEND_PORT}, ${REMOTE_OCR_PORT}→${OCR_PORT}, ${REMOTE_MEDICAL_PORT}→${MEDICAL_PORT})"
"${CMD[@]}" >>"${LOG_FILE}" 2>&1 &
DISOWN_PID=$!

echo "autossh started with PID ${DISOWN_PID}. Logs: ${LOG_FILE}"
