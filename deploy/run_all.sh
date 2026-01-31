#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)

REMOTE_USER=${REMOTE_USER:-root}
REMOTE_HOST=${REMOTE_HOST:-167.179.111.87}
SSH_PORT=${SSH_PORT:-22}

echo "=== Step 1: Starting local services via PM2 (frontend/API/OCR) ==="
"${ROOT_DIR}/deploy/start_local_services.sh"

echo "=== Step 1b: (Optional) Manage autossh tunnel on macOS ==="
if command -v launchctl >/dev/null 2>&1 && [[ "${OSTYPE:-}" == darwin* ]]; then
  echo "Tip: use \`launchctl bootstrap gui/\$(id -u) ~/Library/LaunchAgents/org.clinicalmatch.autossh.plist\` to ensure tunnelling daemon is running."
fi

echo "=== Step 2: Syncing repository and configuring relay (${REMOTE_USER}@${REMOTE_HOST}) ==="
REMOTE_USER="${REMOTE_USER}" REMOTE_HOST="${REMOTE_HOST}" SSH_PORT="${SSH_PORT}" \
  "${ROOT_DIR}/deploy/relay/sync_and_setup.sh"

echo "All services started and relay updated."
