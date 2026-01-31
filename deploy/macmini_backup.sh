#!/usr/bin/env bash
set -euo pipefail

# Backup helper for Mac mini single-machine deployment.
# - Creates MongoDB dump (gzipped archive)
# - Creates uploads manifest (optionally you can rsync uploads separately)
#
# Usage:
#   export HOST_DATA_DIR="$HOME/ClinicalMatchData"
#   ./deploy/macmini_backup.sh

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)

log() { printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"; }
die() { echo "ERROR: $*" >&2; exit 1; }

ensure_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "Required command not found: $1"
}

ensure_cmd docker
ensure_cmd tar

SHA_CMD=""
if command -v sha256sum >/dev/null 2>&1; then
  SHA_CMD="sha256sum"
elif command -v shasum >/dev/null 2>&1; then
  SHA_CMD="shasum -a 256"
fi

if [[ -z "${HOST_DATA_DIR:-}" ]]; then
  die "HOST_DATA_DIR is not set. Example: export HOST_DATA_DIR=\"$HOME/ClinicalMatchData\""
fi

BACKUP_DIR="${HOST_DATA_DIR}/backups/$(date '+%Y%m%d-%H%M%S')"
mkdir -p "${BACKUP_DIR}"

log "Backup dir: ${BACKUP_DIR}"

log "Dumping MongoDB from container clinicalmatch-mongodb..."
docker exec clinicalmatch-mongodb sh -lc "mongodump --archive --gzip --db=clinicalmatch" > "${BACKUP_DIR}/mongo.archive.gz"

log "Writing uploads manifest (paths + sizes)..."
(
  cd "${HOST_DATA_DIR}/uploads"
  find . -type f -maxdepth 3 -print0 | xargs -0 ls -ln 2>/dev/null || true
) > "${BACKUP_DIR}/uploads.manifest.txt"

if [[ -n "${SHA_CMD}" ]]; then
  log "Checksums..."
  (cd "${BACKUP_DIR}" && ${SHA_CMD} mongo.archive.gz uploads.manifest.txt > SHA256SUMS)
fi

log "Done."
log "Note: for full file backup, consider rsyncing ${HOST_DATA_DIR}/uploads to an external disk or cloud bucket."
