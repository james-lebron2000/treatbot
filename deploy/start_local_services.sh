#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
ENV_FILE="${ROOT_DIR}/deploy/.env.production"
export PM2_HOME="${ROOT_DIR}/.pm2"
mkdir -p "${PM2_HOME}"

if [[ -f "${ENV_FILE}" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "${ENV_FILE}"
  set +a
fi

log() {
  printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$1"
}

ensure_dep() {
  if ! command -v "$1" >/dev/null 2>&1; then
    log "ERROR: Required command '$1' not found in PATH."
    exit 1;
  fi
}

ensure_dep node
ensure_dep npm
ensure_dep python3
ensure_dep pm2

NODE_MAJOR_VERSION=$(node -p "process.versions.node.split('.')[0]" | tr -d '\n')
if [[ -n "${NODE_MAJOR_VERSION}" && "${NODE_MAJOR_VERSION}" -ge 22 ]]; then
  log "WARNING: Detected Node.js ${NODE_MAJOR_VERSION}. PM2/AsyncHooks may be unstable on Node >=22. Prefer Node 20 LTS for production-like runs."
fi

log "Ensuring Redis is running (brew services start redis)"
if ! redis-cli ping >/dev/null 2>&1; then
  if command -v brew >/dev/null 2>&1; then
    brew services start redis >/dev/null 2>&1 || true
    sleep 2
  fi
fi

if ! redis-cli ping >/dev/null 2>&1; then
  log "WARNING: Redis is not responding on ${REDIS_HOST:-127.0.0.1}:${REDIS_PORT:-6379}"
fi

log "Ensuring Node.js dependencies (frontend/backend)"
if [[ ! -d "${ROOT_DIR}/client/node_modules" ]]; then
  log "Installing frontend dependencies"
  NPM_CONFIG_PRODUCTION=false npm install --prefix "${ROOT_DIR}/client" >/dev/null
else
  log "Frontend dependencies already installed, skipping npm install"
fi

if [[ ! -d "${ROOT_DIR}/server/node_modules" ]]; then
  log "Installing backend dependencies"
  NPM_CONFIG_PRODUCTION=false npm install --prefix "${ROOT_DIR}/server" >/dev/null
else
  log "Backend dependencies already installed, skipping npm install"
fi

log "Building Next.js frontend"
npm run build --prefix "${ROOT_DIR}/client"

log "Preparing Python OCR virtual environment"
PY_VENV_DIR="${ROOT_DIR}/python_ocr_service/.venv"
if [[ ! -d "${PY_VENV_DIR}" ]]; then
  python3 -m venv "${PY_VENV_DIR}"
fi
if [[ "${SKIP_PYTHON_OCR:-0}" == "1" ]]; then
  log "Skipping Python OCR dependency install (SKIP_PYTHON_OCR=1)"
else
  # shellcheck disable=SC1090
  source "${PY_VENV_DIR}/bin/activate"
  if ! pip install --upgrade pip >/dev/null; then
    log "WARNING: Failed to upgrade pip (possibly offline), continuing with existing version"
  fi
  if ! pip install -r "${ROOT_DIR}/python_ocr_service/requirements.txt" >/dev/null; then
    log "WARNING: Failed to install Python OCR dependencies, continuing (ensure requirements are available)"
  fi
  deactivate
fi

log "Starting services via PM2"
if [[ "${SKIP_PM2:-0}" == "1" ]]; then
  log "Skipping PM2 launch (SKIP_PM2=1). Use npm scripts or docker-compose manually."
else
  log "Stopping previously running PM2 processes (if any)"
  pm2 delete trial-match-frontend >/dev/null 2>&1 || true
  pm2 delete trial-match-medical-api >/dev/null 2>&1 || true
  pm2 delete trial-match-ocr >/dev/null 2>&1 || true

  # Warn if default ports already in use
  for port in 3000 5001 5002; do
    if lsof -nP -iTCP:"${port}" -sTCP:LISTEN >/dev/null 2>&1; then
      log "WARNING: Port ${port} is already in use. The corresponding PM2 process may fail to start."
    fi
  done

  if ! pm2 start "${ROOT_DIR}/ecosystem.config.js"; then
    log "ERROR: pm2 start failed. Check compatibility between PM2 and Node.js (Node >=22 may trigger AsyncHook issues)."
    log "Hint: Try SKIP_PM2=1 npm run dev:all, or run with Node 20 LTS."
    exit 1
  fi
  pm2 save || log "WARNING: Unable to save PM2 process list."
  log "Services started. Use 'PM2_HOME=${PM2_HOME} pm2 status' to inspect process health."
fi
