#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
AUTOSSH_ENV_FILE="${ROOT_DIR}/deploy/autossh.env"

# Load autossh defaults if present
if [[ -f "${AUTOSSH_ENV_FILE}" ]]; then
  # shellcheck disable=SC1090
  source "${AUTOSSH_ENV_FILE}"
fi

REMOTE_USER=${REMOTE_USER:-${AUTOSSH_REMOTE_USER:-root}}
REMOTE_HOST=${REMOTE_HOST:-${AUTOSSH_REMOTE_HOST:-}}
SSH_PORT=${SSH_PORT:-${AUTOSSH_SSH_PORT:-22}}
IDENTITY_FILE=${IDENTITY_FILE:-${SSH_IDENTITY_FILE:-}}
PROJECT_ROOT=${PROJECT_ROOT:-/opt/trial-match}
DOMAIN=${DOMAIN:-findclinicaltrial.org}
DEPLOY_TARGET_CONF="deploy/relay/nginx-${DOMAIN}.conf"

if [[ -z "${REMOTE_HOST}" ]]; then
  echo "REMOTE_HOST (or AUTOSSH_REMOTE_HOST) is not set. Aborting." >&2
  exit 1
fi

if [[ ! -f "${ROOT_DIR}/${DEPLOY_TARGET_CONF}" ]]; then
  echo "Expected nginx config ${DEPLOY_TARGET_CONF} not found in repository. Aborting." >&2
  exit 1
fi

SSH_BASE_CMD=(ssh "-p" "${SSH_PORT}")
if [[ -n "${IDENTITY_FILE}" ]]; then
  SSH_BASE_CMD+=("-i" "${IDENTITY_FILE}")
fi
SSH_BASE_CMD+=("${REMOTE_USER}@${REMOTE_HOST}")

RSYNC_BASE_CMD=(rsync -az --delete --exclude '.git' --exclude 'node_modules' --exclude '.pm2' --exclude 'logs' --exclude 'uploads' -e)
SSH_RSYNC_CMD="ssh -p ${SSH_PORT}"
if [[ -n "${IDENTITY_FILE}" ]]; then
  SSH_RSYNC_CMD+=" -i ${IDENTITY_FILE}"
fi
RSYNC_BASE_CMD+=("${SSH_RSYNC_CMD}")

echo ">>> Creating project directory ${PROJECT_ROOT} on ${REMOTE_HOST}"
"${SSH_BASE_CMD[@]}" "sudo mkdir -p '${PROJECT_ROOT}' && sudo chown -R ${REMOTE_USER}:${REMOTE_USER} '${PROJECT_ROOT}'"

echo ">>> Syncing repository to ${REMOTE_HOST}:${PROJECT_ROOT}"
"${RSYNC_BASE_CMD[@]}" "${ROOT_DIR}/" "${REMOTE_USER}@${REMOTE_HOST}:${PROJECT_ROOT}/"

echo ">>> Running relay setup on ${REMOTE_HOST}"
"${SSH_BASE_CMD[@]}" "cd '${PROJECT_ROOT}' && sudo DOMAIN='${DOMAIN}' PROJECT_ROOT='${PROJECT_ROOT}' ./deploy/relay/setup_relay.sh"

echo "Relay synchronization and setup complete."
