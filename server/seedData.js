const { ClinicalTrial } = require('./models');
const { syncEligibilityForTrials } = require('./scripts/syncTrialEligibility');
const logger = require('./utils/logger');

// Mock clinical trials data
const mockTrials = [
  {
    trialId: "NCT001234567",
    title: "KRAS G12C抑制剂治疗晚期肺腺癌的II期临床试验",
    location: "北京协和医院",
    phase: "Phase II",
    condition: "肺腺癌",
    sponsor: "某制药公司A",
    inclusionCriteria: [
      "年龄18-75岁",
      "组织学确诊的晚期肺腺癌",
      "KRAS G12C突变阳性",
      "ECOG PS 0-2分",
      "分期允许: III期或以上",
      "既往至少接受过一线治疗失败"
    ],
    exclusionCriteria: [
      "既往接受过KRAS抑制剂治疗",
      "活动性脑转移",
      "严重心脏疾病"
    ],
    targetMutations: ["KRAS"],
    ageRange: { min: 18, max: 75 },
    gender: "both",
    status: "recruiting",
    estimatedEnrollment: 120,
    contactInfo: {
      name: "李医生",
      phone: "010-12345678",
      email: "dr.li@hospital.com"
    }
  },
  {
    trialId: "NCT001234568", 
    title: "BRCA突变三阴性乳腺癌PARP抑制剂治疗研究",
    location: "上海瑞金医院",
    phase: "Phase III",
    condition: "三阴性乳腺癌",
    sponsor: "某制药公司B",
    inclusionCriteria: [
      "年龄18-65岁",
      "三阴性乳腺癌",
      "BRCA1或BRCA2胚系突变",
      "ECOG PS 0-1分",
      "分期允许: II期及以上"
    ],
    exclusionCriteria: [
      "既往接受过PARP抑制剂",
      "同时患有其他恶性肿瘤"
    ],
    targetMutations: ["BRCA1", "BRCA2"],
    ageRange: { min: 18, max: 65 },
    gender: "female",
    status: "recruiting",
    estimatedEnrollment: 200,
    contactInfo: {
      name: "王医生",
      phone: "021-87654321", 
      email: "dr.wang@hospital.com"
    }
  },
  {
    trialId: "NCT001234569",
    title: "MSI-H结直肠癌免疫检查点抑制剂联合治疗",
    location: "广州中山大学肿瘤防治中心",
    phase: "Phase II",
    condition: "结直肠癌",
    sponsor: "某制药公司C",
    inclusionCriteria: [
      "年龄18-70岁",
      "转移性结直肠癌",
      "MSI-H或dMMR",
      "ECOG PS 0-2分",
      "Stage IV"
    ],
    exclusionCriteria: [
      "既往接受过PD-1/PD-L1抑制剂",
      "自身免疫性疾病"
    ],
    targetMutations: ["MSI-H"],
    ageRange: { min: 18, max: 70 },
    gender: "both", 
    status: "recruiting",
    estimatedEnrollment: 80,
    contactInfo: {
      name: "张医生",
      phone: "020-11223344",
      email: "dr.zhang@hospital.com"
    }
  },
  {
    trialId: "NCT001234570",
    title: "HER2阳性胃癌靶向治疗新药临床试验",
    location: "天津市肿瘤医院",
    phase: "Phase I/II",
    condition: "胃癌",
    sponsor: "某制药公司D",
    inclusionCriteria: [
      "年龄18-75岁",
      "HER2阳性胃癌",
      "既往标准治疗失败",
      "ECOG PS 0-2分",
      "分期: III/IV 期"
    ],
    exclusionCriteria: [
      "心脏功能异常",
      "活动性感染"
    ],
    targetMutations: ["HER2"],
    ageRange: { min: 18, max: 75 },
    gender: "both",
    status: "recruiting", 
    estimatedEnrollment: 60,
    contactInfo: {
      name: "赵医生",
      phone: "022-99887766",
      email: "dr.zhao@hospital.com"
    }
  },
  {
    trialId: "NCT001234571",
    title: "EGFR突变肺癌第三代TKI耐药后治疗策略研究",
    location: "杭州浙江大学医学院附属第一医院",
    phase: "Phase II",
    condition: "肺癌", 
    sponsor: "某制药公司E",
    inclusionCriteria: [
      "年龄18-70岁",
      "EGFR突变肺癌",
      "第三代TKI治疗耐药",
      "ECOG PS 0-1分",
      "分期包含: IIIB/IV"
    ],
    exclusionCriteria: [
      "T790M突变阴性",
      "间质性肺炎病史"
    ],
    targetMutations: ["EGFR", "T790M"],
    ageRange: { min: 18, max: 70 },
    gender: "both",
    status: "recruiting",
    estimatedEnrollment: 100,
    contactInfo: {
      name: "陈医生", 
      phone: "0571-55667788",
      email: "dr.chen@hospital.com"
    }
  }
];

async function seedTrialsWithoutTransactions() {
  const started = Date.now();

  try {
    await ClinicalTrial.deleteMany({});
    const inserted = await ClinicalTrial.insertMany(mockTrials, { ordered: true });

    const syncResult = await syncEligibilityForTrials({
      trialIds: inserted.map((trial) => trial._id)
    });

    const durationMs = Date.now() - started;

    logger.info({
      action: 'seedTrials',
      trialsInserted: inserted.length,
      syncResult,
      durationMs,
      transactional: false
    }, 'Mock clinical trials seeded without transactions');

    return {
      success: true,
      count: inserted.length,
      sync: syncResult,
      durationMs
    };
  } catch (error) {
    logger.error({ err: error }, 'Error seeding trials without transactions');
    return { success: false, error: error.message };
  }
}

// Function to seed the database with mock trials
async function seedTrials() {
  const session = await ClinicalTrial.startSession();
  const started = Date.now();
  let fallbackToNonTransactional = false;

  try {
    session.startTransaction();

    await ClinicalTrial.deleteMany({}, { session });
    const inserted = await ClinicalTrial.insertMany(mockTrials, { session, ordered: true });

    const syncResult = await syncEligibilityForTrials({
      trialIds: inserted.map((trial) => trial._id),
      session
    });

    await session.commitTransaction();

    const durationMs = Date.now() - started;
    logger.info({
      action: 'seedTrials',
      trialsInserted: inserted.length,
      syncResult,
      durationMs,
      transactional: true
    }, 'Mock clinical trials seeded and synchronized');

    return {
      success: true,
      count: inserted.length,
      sync: syncResult,
      durationMs
    };
  } catch (error) {
    if (session.inTransaction()) {
      await session.abortTransaction();
    }

    if (error?.code === 20 || /Transaction numbers are only allowed/.test(error?.message || '')) {
      logger.warn({ err: error }, 'Transactions unsupported, will retry seeding without transactions');
      fallbackToNonTransactional = true;
    }

    if (!fallbackToNonTransactional) {
      logger.error({ err: error }, 'Error seeding trials, rolling back');
      return { success: false, error: error.message };
    }
  } finally {
    session.endSession();
  }

  if (fallbackToNonTransactional) {
    return seedTrialsWithoutTransactions();
  }
}

module.exports = { seedTrials, mockTrials };
