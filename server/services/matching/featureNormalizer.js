const STAGE_PATTERNS = {
  advanced: /(iv|4期|四期|转移|晚期|终末|广泛|多发|复发|不可切除)/i,
  locally_advanced: /(iii|3期|三期|局部晚期|不可切除)/i,
  early: /(i|ii|1期|2期|早期|术后|辅助)/i
};

const BIOMARKER_ALIASES = {
  pdl1: [/pd[-\s]?l1/i, /cps/i, /combined positive score/i],
  kras: [/kras/i],
  nras: [/nras/i],
  braf: [/braf/i],
  msi: [/msi/i, /microsatellite/i],
  tmb: [/tmb/i, /tumor mutation burden/i],
  egfr: [/egfr/i],
  alk: [/alk/i],
  ros1: [/ros1/i]
};

const THERAPY_ALIASES = {
  immunotherapy: [/pd-?1/i, /pd-?l1/i, /ctla-?4/i, /免疫/],
  targeted: [/仑伐替尼|瑞戈非尼|靶向|酪氨酸|tki/i],
  chemotherapy: [/化疗|platinum|铂类|紫杉|氟尿嘧啶/i],
  anti_angiogenic: [/贝伐珠珠?单抗|抗血管/i]
};

function normaliseStage(stageText) {
  if (!stageText) return null;
  const text = String(stageText).trim();
  if (!text) return null;
  if (STAGE_PATTERNS.advanced.test(text)) return 'advanced';
  if (STAGE_PATTERNS.locally_advanced.test(text)) return 'locally_advanced';
  if (STAGE_PATTERNS.early.test(text) && !STAGE_PATTERNS.advanced.test(text)) return 'early';
  return null;
}

function normaliseBiomarkers(raw = {}) {
  const result = new Map();
  Object.entries(raw).forEach(([key, value]) => {
    const normalizedValue = value == null ? '' : String(value).trim();
    if (!normalizedValue) return;
    const normalizedKey = String(key).trim();
    const aliasEntry = Object.entries(BIOMARKER_ALIASES).find(([, patterns]) =>
      patterns.some((pattern) => pattern.test(normalizedKey))
    );
    const targetKey = aliasEntry ? aliasEntry[0] : normalizedKey.toLowerCase();
    result.set(targetKey, normalizedValue.toLowerCase());
  });
  return result;
}

function normaliseTherapyHistory(entries = []) {
  const categories = new Set();
  const drugs = new Set();
  entries.forEach((entry) => {
    if (!entry) return;

    if (typeof entry === 'string') {
      const normalized = entry.trim();
      if (!normalized) return;
      drugs.add(normalized.toLowerCase());
      Object.entries(THERAPY_ALIASES).forEach(([category, patterns]) => {
        if (patterns.some((pattern) => pattern.test(normalized))) {
          categories.add(category);
        }
      });
      return;
    }

    const possibleNames = [];
    if (Array.isArray(entry.regimen)) {
      possibleNames.push(...entry.regimen);
    }
    ['name', 'drug', 'drug_or_procedure', 'medication', 'therapy'].forEach((key) => {
      if (entry[key]) {
        possibleNames.push(entry[key]);
      }
    });

    possibleNames.forEach((name) => {
      if (!name) return;
      const normalized = String(name).trim();
      if (!normalized) return;
      drugs.add(normalized.toLowerCase());
      Object.entries(THERAPY_ALIASES).forEach(([category, patterns]) => {
        if (patterns.some((pattern) => pattern.test(normalized))) {
          categories.add(category);
        }
      });
    });
  });
  return { categories, drugs };
}

function extractPatientFeatures(patientData = {}) {
  const stageKeyword = normaliseStage(
    patientData.staging_value
    || patientData.stage
    || patientData.current_status?.stage
  );

  const biomarkers = normaliseBiomarkers(patientData.molecular_testing || {});
  const therapySource = Array.isArray(patientData.previous_treatments)
    ? patientData.previous_treatments
    : Array.isArray(patientData.systemic_treatments)
      ? patientData.systemic_treatments
      : Array.isArray(patientData.treatments)
        ? patientData.treatments
        : [];
  const therapies = normaliseTherapyHistory(therapySource);

  const diseaseLabels = Array.isArray(patientData.disease_labels)
    ? patientData.disease_labels.map((label) => String(label).trim()).filter(Boolean)
    : [];

  return {
    stageKeyword,
    biomarkers,
    therapyCategories: therapies.categories,
    therapyDrugs: therapies.drugs,
    diseaseLabels
  };
}

module.exports = {
  extractPatientFeatures,
  normaliseStage,
  normaliseBiomarkers,
  normaliseTherapyHistory
};
