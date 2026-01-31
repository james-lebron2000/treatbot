const fs = require('fs/promises');
const path = require('path');
const mongoose = require('mongoose');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const config = require('../config');
const logger = require('../utils/logger');
const { ClinicalTrial } = require('../models');
const { syncEligibilityForTrials } = require('./syncTrialEligibility');

function parseCsv(content) {
  const lines = content.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length === 0) return [];

  const headers = lines.shift().split(',').map((h) => h.trim());
  return lines.map((line) => {
    const columns = line.split(',');
    const record = {};
    headers.forEach((key, index) => {
      record[key] = (columns[index] || '').trim();
    });
    return record;
  });
}

function parseList(field) {
  if (!field || typeof field !== 'string') return [];
  return field
    .split(/\||;|、/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function parseTrialRecord(record) {
  const ageMin = Number(record.ageMin || record.age_min || record.age_minimum);
  const ageMax = Number(record.ageMax || record.age_max || record.age_maximum);

  const trial = {
    trialId: record.trialId || record.trial_id || record.id || undefined,
    title: record.title || record.name || '未命名临床试验',
    location: record.location || record.city || record.site || undefined,
    phase: record.phase || record.trialPhase || undefined,
    condition: record.condition || record.disease || undefined,
    sponsor: record.sponsor || record.organizer || undefined,
    inclusionCriteria: parseList(record.inclusionCriteria || record.inclusions),
    exclusionCriteria: parseList(record.exclusionCriteria || record.exclusions),
    targetMutations: parseList(record.targetMutations || record.biomarkers),
    ageRange: Number.isFinite(ageMin) || Number.isFinite(ageMax)
      ? {
          min: Number.isFinite(ageMin) ? ageMin : 0,
          max: Number.isFinite(ageMax) ? ageMax : 120
        }
      : undefined,
    gender: record.gender || record.sex || 'both',
    status: record.status || 'recruiting',
    estimatedEnrollment: Number(record.estimatedEnrollment || record.enrollment) || undefined,
    contactInfo: {
      name: record.contactName || record.contact_name || undefined,
      phone: record.contactPhone || record.contact_phone || undefined,
      email: record.contactEmail || record.contact_email || undefined
    }
  };

  if (!trial.trialId) {
    throw new Error('trialId is required for import');
  }

  return trial;
}

async function importTrialsFromCsv({ dryRun = false, truncate = false } = {}) {
  const csvPath = config.trialCsvPath;
  const content = await fs.readFile(csvPath, 'utf8');
  const rows = parseCsv(content);
  if (rows.length === 0) {
    logger.warn({ csvPath }, 'No rows parsed from CSV');
    return { inserted: 0, updated: 0, skipped: 0, dryRun, trials: [] };
  }

  const trials = rows.map(parseTrialRecord);
  const session = dryRun ? null : await ClinicalTrial.startSession();
  if (session) {
    session.startTransaction();
  }

  const stats = {
    inserted: 0,
    updated: 0,
    skipped: 0,
    dryRun,
    trials: []
  };

  try {
    if (truncate && !dryRun) {
      await ClinicalTrial.deleteMany({}, { session });
    }

    for (const trialData of trials) {
      stats.trials.push(trialData.trialId);
      if (dryRun) {
        continue;
      }

      const updateResult = await ClinicalTrial.updateOne(
        { trialId: trialData.trialId },
        { $set: trialData },
        { upsert: true, session, setDefaultsOnInsert: true }
      );

      if (updateResult.upsertedCount) {
        stats.inserted += 1;
      } else if (updateResult.modifiedCount) {
        stats.updated += 1;
      } else {
        stats.skipped += 1;
      }
    }

    if (!dryRun) {
      const insertedTrials = await ClinicalTrial.find({ trialId: { $in: stats.trials } }, '_id').session(session);
      await syncEligibilityForTrials({
        trialIds: insertedTrials.map((trial) => trial._id),
        session
      });
      await session.commitTransaction();
      logger.info({
        csvPath,
        inserted: stats.inserted,
        updated: stats.updated,
        total: stats.trials.length
      }, '[importTrialsFromCsv] Import completed');
    } else {
      logger.info({ csvPath, total: stats.trials.length }, '[importTrialsFromCsv] Dry run completed');
    }

    return stats;
  } catch (error) {
    if (session) {
      await session.abortTransaction();
    }
    logger.error({ err: error }, '[importTrialsFromCsv] Failed');
    throw error;
  } finally {
    if (session) {
      session.endSession();
    }
  }
}

async function main() {
  const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/clinicalmatch';
  const args = process.argv.slice(2);
  const options = {
    dryRun: args.includes('--dry-run'),
    truncate: args.includes('--truncate')
  };

  await mongoose.connect(mongoUri);
  logger.info({ mongoUri, options }, '[importTrialsFromCsv] Connected to MongoDB');

  try {
    await importTrialsFromCsv(options);
    await mongoose.disconnect();
    process.exit(0);
  } catch (err) {
    logger.error({ err }, '[importTrialsFromCsv] Execution failed');
    await mongoose.disconnect();
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  importTrialsFromCsv
};
