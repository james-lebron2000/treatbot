const METASTASIS_TERMS = [
  '肝', '肺', '骨', '脑', '腹膜', '淋巴结', '胸水', '腹水', '腰肌', '脊柱', '肾上腺'
];

function normalizeGender(gender) {
  if (!gender) return null;
  if (typeof gender === 'string') {
    if (['男', 'male', '男性'].includes(gender.toLowerCase() === 'male' ? 'male' : gender)) {
      return 'male';
    }
    if (['女', 'female', '女性'].includes(gender.toLowerCase() === 'female' ? 'female' : gender)) {
      return 'female';
    }
  }
  return null;
}

function parseStage(value) {
  if (!value) return { system: null, stage: null, mvi: null };
  const text = String(value);
  const stageMatch = text.match(/(TNM|BCLC|CNLC|Child-?Pugh|AJCC)\s*[:：]?\s*([A-Za-z0-9\.\-]+)(?:期)?/i);
  const mviMatch = text.match(/MVI[：: ]?([M]?\d)/i);
  return {
    system: stageMatch ? stageMatch[1].toUpperCase().replace('CHILD-PUGH', 'Child-Pugh') : null,
    stage: stageMatch ? stageMatch[2].toUpperCase() : null,
    mvi: mviMatch ? mviMatch[1].toUpperCase() : null
  };
}

function normalizeMetastasis(value) {
  if (!value) return [];
  const terms = Array.isArray(value) ? value : String(value).split(/[、,，;；\s]+/);
  const cleaned = terms
    .map((term) => term.trim())
    .filter(Boolean)
    .flatMap((term) => {
      const matches = METASTASIS_TERMS.filter((candidate) => term.includes(candidate));
      return matches.length ? matches : [term];
    });
  return Array.from(new Set(cleaned));
}

function coerceNumber(val) {
  if (val === null || val === undefined) return null;
  if (typeof val === 'number' && !Number.isNaN(val)) return val;
  const num = parseFloat(String(val).replace(/[^0-9.+-]/g, ''));
  return Number.isNaN(num) ? null : num;
}

function normalizeLabGroup(group) {
  if (!group || typeof group !== 'object') return group;
  const normalized = { ...group };
  for (const key of Object.keys(normalized)) {
    if (normalized[key] && typeof normalized[key] === 'object' && !Array.isArray(normalized[key])) {
      normalized[key] = normalizeLabGroup(normalized[key]);
    } else {
      normalized[key] = coerceNumber(normalized[key]);
    }
  }
  return normalized;
}

function normalizeSystemicTreatments(treatments = []) {
  if (!Array.isArray(treatments)) return [];
  return treatments
    .map((item, index) => {
      const copy = { ...item };
      copy.line = copy.line || index + 1;
      copy.regimen = Array.isArray(copy.regimen) ? copy.regimen.filter(Boolean) : [];
      copy.drug_classes = Array.isArray(copy.drug_classes) ? copy.drug_classes.filter(Boolean) : [];
      return copy;
    });
}

function normalizeStructuredData(raw = {}) {
  const data = { ...raw };

  // Gender & age
  if (data.gender) data.gender = normalizeGender(data.gender) || data.gender;
  if (data.age !== undefined && data.age !== null) data.age = coerceNumber(data.age) ? Math.round(coerceNumber(data.age)) : null;

  // Diagnosis / staging
  if (!data.primary_diagnosis && data.diagnosis) {
    data.primary_diagnosis = data.diagnosis;
  }
  const stageInfo = parseStage(data.staging_value || data.stage);
  data.staging_system = data.staging_system || stageInfo.system;
  data.staging_value = data.staging_value || stageInfo.stage;
  data.mvi_grade = data.mvi_grade || stageInfo.mvi;

  // Metastasis
  data.metastasis_sites = normalizeMetastasis(data.metastasis_sites || data.metastasis);

  if (data.cns_metastasis && typeof data.cns_metastasis.present === 'string') {
    data.cns_metastasis.present = /是|true|有/.test(data.cns_metastasis.present.toLowerCase());
  }

  // ECOG
  if (data.ecog_score !== undefined && data.ecog_score !== null) {
    data.ecog_score = coerceNumber(data.ecog_score);
    if (data.ecog_score !== null) data.ecog_score = Math.max(0, Math.min(4, Math.round(data.ecog_score)));
  }

  // Labs
  if (data.lab_values) {
    data.lab_values = normalizeLabGroup(data.lab_values);
  }

  // Viral status normalization (string ensure limited values)
  if (data.viral_hepatitis?.hbv_status) {
    const status = String(data.viral_hepatitis.hbv_status);
    if (/阳/.test(status)) data.viral_hepatitis.hbv_status = '阳性';
    else if (/阴/.test(status)) data.viral_hepatitis.hbv_status = '阴性';
    else if (/既往/.test(status)) data.viral_hepatitis.hbv_status = '既往感染';
  }

  // Treatments
  if (data.systemic_treatments) {
    data.systemic_treatments = normalizeSystemicTreatments(data.systemic_treatments);
    if (!data.total_treatment_lines) {
      data.total_treatment_lines = data.systemic_treatments.length || null;
    }
  }

  return data;
}

module.exports = {
  normalizeStructuredData
};
