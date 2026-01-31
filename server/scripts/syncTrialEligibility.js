const path = require('path');
const mongoose = require('mongoose');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { ClinicalTrial } = require('../models');
const logger = require('../utils/logger');
const { recordTrialSyncMetrics } = require('../monitoring/metrics');

const CATEGORY_KEYWORDS = [
  { category: 'demographics', keywords: ['年龄', 'age', 'gender', '性别'] },
  { category: 'diagnosis', keywords: ['诊断', '肿瘤', '癌', 'disease', '病灶', '病理'] },
  { category: 'performance_status', keywords: ['ECOG', 'PS', 'KPS'] },
  { category: 'labs', keywords: ['实验室', '血小板', 'platelet', '血红蛋白', 'hemoglobin', '中性粒', 'ALT', 'AST', 'bilirubin', '肌酐', 'creatinine', '白蛋白', 'albumin', 'INR', '乳酸脱氢酶', 'ldh'] },
  { category: 'infection', keywords: ['HBV', 'HCV', 'HIV', '乙肝', '丙肝', '梅毒', '感染'] },
  { category: 'pregnancy', keywords: ['妊娠', '孕', '哺乳', 'pregnant', 'breastfeeding'] },
  { category: 'treatment_history', keywords: ['既往治疗', 'lines', '线治疗', '手术', '化疗', 'radiotherapy', '靶向', '免疫'] },
  { category: 'organ_function', keywords: ['器官功能', '肝功能', '肾功能', '心功能', '肺功能'] },
  { category: 'comorbidity', keywords: ['合并', '并发', '心血管', '糖尿病', '高血压'] }
];

function toNumber(value) {
  if (!value) return null;
  const normalized = value.replace(/,/g, '').replace(/×/g, 'x');
  const sciMatch = normalized.match(/(-?\d+(?:\.\d+)?)\s*[xX]\s*10\^(\d+)/);
  if (sciMatch) {
    return Number(sciMatch[1]) * 10 ** Number(sciMatch[2]);
  }
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function extractUnit(text) {
  const unitMatch = text.match(/(g\/L|IU\/mL|IU\/ml|U\/L|mg\/dL|mmol\/L|x\s?10\^\d+\/L|×10\^\d+\/L|×10\^9\/L|%|mmHg|kPa|cells\/mm³|cells\/ul|ml\/min)/i);
  return unitMatch ? unitMatch[0] : undefined;
}

function parseNumericRequirement(text) {
  if (!text) return null;
  const normalized = text.replace(/，/g, ',').replace(/；/g, ';');
  const unit = extractUnit(normalized);
  const rangeMatch = normalized.match(/(\d+(?:\.\d+)?)\s*(?:-|~|至|到|～)\s*(\d+(?:\.\d+)?)/);
  if (rangeMatch) {
    return {
      type: 'numeric',
      min: toNumber(rangeMatch[1]),
      max: toNumber(rangeMatch[2]),
      unit
    };
  }

  const requirement = { type: 'numeric', unit };
  let hasNumeric = false;

  const minToken = normalized.match(/(≥|>=|不少于|不小于|至少|大于等于)\s*(\d+(?:\.\d+)?)/);
  if (minToken) {
    requirement.min = toNumber(minToken[2]);
    hasNumeric = true;
  }

  const maxToken = normalized.match(/(≤|<=|不大于|至多|最多|小于等于)\s*(\d+(?:\.\d+)?)/);
  if (maxToken) {
    requirement.max = toNumber(maxToken[2]);
    hasNumeric = true;
  }

  const gtToken = normalized.match(/(>|大于)(?!\s*=)\s*(\d+(?:\.\d+)?)/);
  if (gtToken) {
    requirement.min = toNumber(gtToken[2]);
    requirement.exclusiveMin = true;
    hasNumeric = true;
  }

  const ltToken = normalized.match(/(<|小于)(?!\s*=)\s*(\d+(?:\.\d+)?)/);
  if (ltToken) {
    requirement.max = toNumber(ltToken[2]);
    requirement.exclusiveMax = true;
    hasNumeric = true;
  }

  const eqToken = normalized.match(/(=|等于)\s*(\d+(?:\.\d+)?)/);
  if (eqToken && !hasNumeric) {
    requirement.exact = toNumber(eqToken[2]);
    hasNumeric = true;
  }

  if (!hasNumeric) {
    return null;
  }

  return requirement;
}

function classifyCriterion(text, defaultCategory = 'general') {
  if (!text) return defaultCategory;
  const lower = text.toLowerCase();
  for (const { category, keywords } of CATEGORY_KEYWORDS) {
    if (keywords.some((keyword) => lower.includes(keyword.toLowerCase()))) {
      return category;
    }
  }
  return defaultCategory;
}

function slugifyText(input) {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

function makeCriterionId(text, prefix, index) {
  if (!text) return `${prefix}-${index}`;
  const base = slugifyText(text).slice(0, 48);
  return base || `${prefix}-${index}`;
}

function deriveLabel(text) {
  if (!text) return '未命名标准';
  const segments = text.split(/[，。,.;]/).map((seg) => seg.trim()).filter(Boolean);
  return segments[0]?.slice(0, 40) || text.slice(0, 40);
}

function parseCriterion(text, type, index) {
  const trimmed = (text || '').trim();
  if (!trimmed) return null;

  const requirement = parseNumericRequirement(trimmed) || { type: 'text', value: trimmed };
  const category = classifyCriterion(trimmed, type === 'inclusion' ? 'eligibility_inclusion' : 'eligibility_exclusion');
  const criterionId = makeCriterionId(trimmed, type === 'inclusion' ? 'inc' : 'exc', index);

  return {
    criterionId,
    label: deriveLabel(trimmed),
    category,
    criterion: trimmed,
    requirement
  };
}

function parseCriteria(list = [], type) {
  if (!Array.isArray(list) || list.length === 0) return [];
  return list
    .map((text, index) => parseCriterion(text, type, index))
    .filter(Boolean);
}

async function syncEligibilityForTrials({ trialIds = null, session = null, dryRun = false } = {}) {
  const started = Date.now();
  const query = Array.isArray(trialIds) && trialIds.length > 0 ? { _id: { $in: trialIds } } : {};
  const queryBuilder = ClinicalTrial.find(query);
  if (session) {
    queryBuilder.session(session);
  }

  let trials;
  try {
    trials = await queryBuilder.exec();
  } catch (err) {
    recordTrialSyncMetrics({ status: 'failed', durationMs: Date.now() - started });
    throw err;
  }

  let updated = 0;
  let totalInclusion = 0;
  let totalExclusion = 0;

  try {
    for (const trial of trials) {
      try {
        const inclusionStructured = parseCriteria(trial.inclusionCriteria || [], 'inclusion');
        const exclusionStructured = parseCriteria(trial.exclusionCriteria || [], 'exclusion');

        if (!dryRun) {
          trial.structuredEligibility = {
            inclusion: inclusionStructured,
            exclusion: exclusionStructured
          };
          trial.eligibilityLastSyncedAt = new Date();
          trial.markModified('structuredEligibility');
          await trial.save({ session });
        }

        updated += 1;
        totalInclusion += inclusionStructured.length;
        totalExclusion += exclusionStructured.length;
      } catch (err) {
        logger.warn({ err, trialId: trial.trialId, _id: trial._id }, 'Failed to sync eligibility for trial');
      }
    }
  } catch (err) {
    recordTrialSyncMetrics({ status: 'failed', durationMs: Date.now() - started });
    throw err;
  }

  const durationMs = Date.now() - started;
  recordTrialSyncMetrics({
    status: dryRun ? 'dry_run' : 'success',
    durationMs,
    inclusionCount: totalInclusion,
    exclusionCount: totalExclusion
  });

  logger.info({
    durationMs,
    updated,
    totalTrials: trials.length,
    totalInclusion,
    totalExclusion,
    dryRun
  }, 'Trial eligibility synchronization completed');

  return {
    durationMs,
    updated,
    totalTrials: trials.length,
    totalInclusion,
    totalExclusion,
    dryRun
  };
}

function parseCliArgs(argv = []) {
  const options = {
    trialIds: [],
    dryRun: false,
    help: false
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--trial-id' && argv[i + 1]) {
      options.trialIds.push(argv[i + 1]);
      i += 1;
    } else if (arg.startsWith('--trial-id=')) {
      options.trialIds.push(arg.split('=')[1]);
    } else if (arg === '--trial-ids' && argv[i + 1]) {
      options.trialIds.push(...argv[i + 1].split(',').map((id) => id.trim()).filter(Boolean));
      i += 1;
    } else if (arg.startsWith('--trial-ids=')) {
      options.trialIds.push(...arg.split('=')[1].split(',').map((id) => id.trim()).filter(Boolean));
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
    }
  }

  options.trialIds = options.trialIds.filter(Boolean);
  return options;
}

function printUsage() {
  console.log(`Usage: node syncTrialEligibility.js [options]\n\nOptions:\n  --trial-id <id>         Sync a single trial by ObjectId\n  --trial-id=<id>         Same as above\n  --trial-ids <id1,id2>   Sync multiple trials (comma separated)\n  --dry-run               Parse criteria without persisting changes\n  -h, --help              Show this help message\n`);
}

async function main() {
  const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/clinicalmatch';
  const cliOptions = parseCliArgs(process.argv.slice(2));

  if (cliOptions.help) {
    printUsage();
    return;
  }

  await mongoose.connect(mongoUri);
  logger.info({ mongoUri, trialIds: cliOptions.trialIds, dryRun: cliOptions.dryRun }, '[syncTrialEligibility] Connected to MongoDB');

  try {
    const result = await syncEligibilityForTrials({
      trialIds: cliOptions.trialIds,
      dryRun: cliOptions.dryRun
    });
    logger.info(result, '[syncTrialEligibility] Completed');
    await mongoose.disconnect();
    process.exit(0);
  } catch (err) {
    recordTrialSyncMetrics({ status: 'failed' });
    logger.error({ err }, '[syncTrialEligibility] Failed');
    await mongoose.disconnect();
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  syncEligibilityForTrials
};
