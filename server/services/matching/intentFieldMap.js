const intentMap = {
  age: {
    path: ['age'],
    type: 'numeric'
  },
  ecog: {
    path: ['ecog_score'],
    type: 'numeric'
  },
  survival: {
    path: ['estimated_survival_months'],
    type: 'numeric'
  },
  platelet: {
    path: ['blood_counts', 'platelet'],
    type: 'numeric'
  },
  hemoglobin: {
    path: ['blood_counts', 'hemoglobin'],
    type: 'numeric'
  },
  neutrophil: {
    path: ['blood_counts', 'anc'],
    type: 'numeric'
  },
  wbc: {
    path: ['blood_counts', 'wbc'],
    type: 'numeric'
  },
  alt: {
    path: ['liver_function', 'alt'],
    type: 'numeric'
  },
  ast: {
    path: ['liver_function', 'ast'],
    type: 'numeric'
  },
  bilirubin: {
    path: ['liver_function', 'tbil'],
    type: 'numeric'
  },
  albumin: {
    path: ['liver_function', 'albumin'],
    type: 'numeric'
  },
  creatinine: {
    path: ['kidney_function', 'creatinine'],
    type: 'numeric'
  },
  urea: {
    path: ['kidney_function', 'urea'],
    type: 'numeric'
  },
  hbv: {
    path: ['viral_hepatitis', 'hbv_status'],
    type: 'text'
  },
  hcv: {
    path: ['viral_hepatitis', 'hcv_status'],
    type: 'text'
  },
  hiv: {
    path: ['viral_hepatitis', 'hiv_status'],
    type: 'text'
  },
  pregnancy: {
    path: ['pregnancy_status'],
    type: 'text'
  },
  organ_function: {
    path: ['organ_function_ok'],
    type: 'boolean'
  },
  measurable: {
    path: ['measurable_lesions'],
    type: 'boolean'
  },
  cns: {
    path: ['metastasis_sites'],
    type: 'list'
  },
  stage: {
    path: ['staging_value'],
    type: 'text'
  },
  gender: {
    path: ['gender'],
    type: 'text'
  },
  disease_labels: {
    path: ['disease_labels'],
    type: 'list'
  }
};

function getValueByPath(source, path) {
  let current = source;
  for (const key of path) {
    if (current == null) {
      return undefined;
    }
    current = current[key];
  }
  return current;
}

function resolvePatientValue(patient, intent) {
  const mapping = intentMap[intent];
  if (!mapping) return undefined;
  const value = getValueByPath(patient, mapping.path);
  if (value === undefined) return undefined;
  if (mapping.type === 'list') {
    if (Array.isArray(value)) return value;
    if (value === null || value === '') return [];
    return [value];
  }
  return value;
}

module.exports = {
  intentMap,
  resolvePatientValue
};
