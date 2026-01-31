/* eslint-disable no-console */
const mongoose = require('mongoose');
const config = require('../config');
const FileMetadata = require('../models/FileMetadata');
const fileStorageService = require('../services/storage/FileStorageService');

function parseBool(value, defaultValue) {
  if (value === undefined || value === null || value === '') return defaultValue;
  const normalized = String(value).toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;
  return defaultValue;
}

function retentionToMs(retention) {
  switch (retention) {
    case '1year':
      return 365 * 24 * 60 * 60 * 1000;
    case '3years':
      return 365 * 3 * 24 * 60 * 60 * 1000;
    case '7years':
      return 365 * 7 * 24 * 60 * 60 * 1000;
    case 'permanent':
    default:
      return null;
  }
}

async function main() {
  const dryRun = parseBool(process.env.RETENTION_DRY_RUN, true);
  const maxDelete = Number(process.env.RETENTION_MAX_DELETE || 500);
  const includeStatuses = String(process.env.RETENTION_INCLUDE_STATUSES || 'active,archived')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  console.log('[retention] connecting to MongoDB...');
  await mongoose.connect(config.mongoUri);

  console.log('[retention] scanning file metadata...');
  const cursor = FileMetadata.find({ status: { $in: includeStatuses } })
    .sort({ createdAt: 1 })
    .cursor();

  let scanned = 0;
  let eligible = 0;
  let deleted = 0;
  const now = Date.now();

  // Process sequentially to avoid IO spikes on a single machine
  // eslint-disable-next-line no-restricted-syntax
  for await (const doc of cursor) {
    scanned += 1;

    const retention = doc.retention || '7years';
    const ttlMs = retentionToMs(retention);
    if (!ttlMs) continue;

    const createdAt = doc.createdAt ? new Date(doc.createdAt).getTime() : null;
    if (!createdAt) continue;

    if (createdAt + ttlMs > now) continue;

    eligible += 1;
    if (eligible <= 20) {
      console.log('[retention] eligible', {
        id: String(doc._id),
        storagePath: doc.storagePath,
        retention,
        createdAt: doc.createdAt
      });
    }

    if (dryRun) continue;
    if (deleted >= maxDelete) break;

    try {
      await fileStorageService.deleteFile(doc.storagePath, { permanent: true, keepBackup: true });
    } catch (err) {
      console.warn('[retention] failed to delete file', { id: String(doc._id), err: err?.message });
    }

    doc.status = 'deleted';
    await doc.save();
    deleted += 1;
  }

  console.log('[retention] done', { scanned, eligible, deleted, dryRun, maxDelete });
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('[retention] fatal', err);
  process.exit(1);
});

