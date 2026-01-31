/*
 * =====================================================
 * Mock NLP Parser - 传统规则解析器
 * =====================================================
 * 职责：使用正则表达式和关键词匹配提取医疗信息
 * 注意：这是后备方案，优先使用 LLM 解析
 * =====================================================
 */

const { firstRegexEvidence, firstSubstringEvidence } = require('./extractionEvidence');

/**
 * 使用规则和正则表达式解析医疗文本（带证据与告警）
 * @param {string} text - 原始医疗文本
 * @returns {{ record: Object, meta: { evidence: Record<string,string|null>, warnings: string[] } }}
 */
function mockNLPParseWithMeta(text) {
  const record = {
    age: null,
    gender: null,
    primary_diagnosis: null,
    pathology_type: null,
    grade: null,
    staging_system: null,
    staging_value: null,
    mvi_grade: null,
    metastasis_sites: [],
    measurable_lesions: null,
    cns_metastasis: {
      present: null,
      treated: null,
      stable: null,
      size_max_cm: null
    },
    bone_metastasis: [],
    ascites_pleural_effusion: {
      ascites: null,
      pleural_effusion: null,
      requires_drainage: null
    },
    ecog_score: null,
    kps_score: null,
    expected_survival_months: null,
    functional_status_description: null,
    systemic_treatments: [],
    total_treatment_lines: null,
    last_treatment_date: null,
    lab_values: {},
    viral_hepatitis: {
      hbv_status: null,
      hbv_dna: null,
      hcv_status: null,
      hcv_rna: null,
      antiviral_treatment: null
    }
  };

  const evidence = {};
  const warnings = [];

  const chinese = text;
  const lower = text.toLowerCase();

  // ========================================
  // 年龄提取 / Age extraction
  // ========================================
  const ageMatch = chinese.match(/(\d{1,3})岁/);
  if (ageMatch) {
    record.age = parseInt(ageMatch[1], 10);
    evidence.age = firstRegexEvidence(chinese, /(\d{1,3})岁/);
  } else {
    const ageEnglish = lower.match(/(\d{1,3})\s*years?\s*old/);
    if (ageEnglish) {
      record.age = parseInt(ageEnglish[1], 10);
      evidence.age = firstRegexEvidence(text, /(\d{1,3})\s*years?\s*old/i);
    }
  }

  // ========================================
  // 性别提取 / Gender extraction
  // ========================================
  if (chinese.includes('男')) {
    record.gender = 'male';
    evidence.gender = evidence.gender || firstSubstringEvidence(chinese, '男');
  }
  if (chinese.includes('女')) {
    record.gender = record.gender === 'male' ? record.gender : 'female';
    evidence.gender = evidence.gender || firstSubstringEvidence(chinese, '女');
  }

  // ========================================
  // 诊断提取 / Diagnosis extraction
  // ========================================
  if (chinese.includes('肝细胞癌')) {
    record.primary_diagnosis = '肝细胞癌';
    evidence.primary_diagnosis = firstSubstringEvidence(chinese, '肝细胞癌');
  } else if (chinese.includes('肺腺癌')) {
    record.primary_diagnosis = '肺腺癌';
    evidence.primary_diagnosis = firstSubstringEvidence(chinese, '肺腺癌');
  }

  // ========================================
  // 病理分级 / Pathology grade
  // ========================================
  const gradeMatch = chinese.match(/(I{1,3}|IV|V)级/);
  if (gradeMatch) {
    record.grade = gradeMatch[0];
    evidence.grade = firstRegexEvidence(chinese, /(I{1,3}|IV|V)级/);
  }

  // ========================================
  // TNM 分期 / TNM staging
  // ========================================
  const tnmMatch = chinese.match(/y?p?T\d+N\d+M\d+/i);
  if (tnmMatch) {
    record.staging_system = 'TNM';
    record.staging_value = tnmMatch[0].toUpperCase();
    evidence.staging_value = firstRegexEvidence(chinese, /y?p?T\d+N\d+M\d+/i);
  }

  // ========================================
  // CNLC/BCLC 分期 / CNLC/BCLC staging
  // ========================================
  const cnlcMatch = chinese.match(/CNLC\s*[IⅤV]+[ab]?/i);
  if (cnlcMatch) {
    record.staging_system = 'CNLC';
    record.staging_value = cnlcMatch[0].replace(/\s+/g, '').toUpperCase().replace('CNLC', '').trim();
    evidence.staging_value = evidence.staging_value || firstRegexEvidence(chinese, /CNLC\s*[IⅤV]+[ab]?/i);
  }
  const bclcMatch = chinese.match(/BCLC\s*[A-D]/i);
  if (bclcMatch) {
    record.staging_system = 'BCLC';
    record.staging_value = bclcMatch[0].replace(/\s+/g, '').replace('BCLC', '').toUpperCase();
    evidence.staging_value = evidence.staging_value || firstRegexEvidence(chinese, /BCLC\s*[A-D]/i);
  }

  // ========================================
  // MVI 分级 / MVI grade
  // ========================================
  const mviMatch = chinese.match(/MVI[：: ]?M(\d)/i);
  if (mviMatch) {
    record.mvi_grade = `M${mviMatch[1]}`;
    evidence.mvi_grade = firstRegexEvidence(chinese, /MVI[：: ]?M(\d)/i);
  }

  // ========================================
  // 转移部位检测 / Metastasis detection
  // ========================================
  const metastasisMap = {
    '肺': ['肺转移'],
    '骨': ['骨转移', '椎体转移', '髂骨'],
    '腹膜': ['腹膜后淋巴结'],
    '淋巴结': ['淋巴结转移'],
    '腰肌': ['腰肌'],
    '脑': ['脑转移', '中枢神经']
  };

  for (const [term, keywords] of Object.entries(metastasisMap)) {
    if (keywords.some((kw) => chinese.includes(kw))) {
      record.metastasis_sites.push(term);
    }
  }

  if (record.metastasis_sites.length > 0) {
    evidence.metastasis_sites = record.metastasis_sites
      .map((site) => firstSubstringEvidence(chinese, site))
      .filter(Boolean)
      .join(' | ') || null;
  }

  if (chinese.includes('胸腔积液')) {
    record.ascites_pleural_effusion.pleural_effusion = true;
    evidence.pleural_effusion = firstSubstringEvidence(chinese, '胸腔积液');
  }
  if (chinese.includes('腹腔积液')) {
    record.ascites_pleural_effusion.ascites = true;
    evidence.ascites = firstSubstringEvidence(chinese, '腹腔积液');
  }

  // ========================================
  // ECOG 评分 / ECOG score
  // ========================================
  const ecogMatch = chinese.match(/ECOG[\sPS：:]*([0-4])/i);
  if (ecogMatch) {
    record.ecog_score = parseInt(ecogMatch[1], 10);
    evidence.ecog_score = firstRegexEvidence(chinese, /ECOG[\sPS：:]*([0-4])/i);
  }

  // ========================================
  // 病毒性肝炎 / Viral hepatitis
  // ========================================
  if (chinese.includes('乙型肝炎')) {
    record.viral_hepatitis.hbv_status = '阳性';
    evidence.hbv_status = firstSubstringEvidence(chinese, '乙型肝炎');
    if (chinese.includes('丙酚替诺福韦')) record.viral_hepatitis.antiviral_treatment = true;
  }

  if (!record.primary_diagnosis) warnings.push('primary diagnosis missing');
  if (!record.staging_value) warnings.push('staging value missing');
  if (record.ecog_score === null || record.ecog_score === undefined) warnings.push('ECOG score missing');

  return { record, meta: { evidence, warnings } };
}

/**
 * 使用规则和正则表达式解析医疗文本
 * @param {string} text - 原始医疗文本
 * @returns {Object} 结构化医疗数据
 */
function mockNLPParse(text) {
  return mockNLPParseWithMeta(text).record;
}

module.exports = {
  mockNLPParse,
  mockNLPParseWithMeta
};
