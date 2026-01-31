const clone = (value) => JSON.parse(JSON.stringify(value ?? null));

const ARCHIVE_TEMPLATE = {
  patient_id: '',
  basic_info: {
    name: '',
    gender: '',
    age: null,
    date_of_birth: '',
    hospital_id: '',
    department: '',
    visit_date: '',
    ethnicity: '',
    height_cm: null,
    weight_kg: null
  },
  medical_history: {
    primary_diagnosis: '',
    onset_date: '',
    disease_course: '',
    previous_malignancies: [],
    comorbidities: [],
    metastasis_sites: [],
    infection_status: {
      HBV: '',
      HCV: '',
      HIV: ''
    }
  },
  treatment_history: [],
  pathology: {
    date: '',
    specimen: '',
    histology: '',
    grade: '',
    stage: '',
    molecular_markers: {
      'PD-L1': '',
      MSI_status: '',
      TMB: '',
      others: {}
    }
  },
  imaging_findings: [],
  lab_results: {
    date: '',
    blood_counts: {
      WBC: '',
      Neutrophils: '',
      Platelets: '',
      Hemoglobin: ''
    },
    liver_function: {
      ALT: '',
      AST: '',
      TBIL: '',
      Albumin: ''
    },
    renal_function: {
      Creatinine: '',
      Urea: ''
    },
    tumor_markers: {
      AFP: '',
      CEA: '',
      CA199: '',
      'PIVKA-II': ''
    }
  },
  ecog_score: '',
  current_status: {
    measurable_lesions: null,
    organ_function_ok: null,
    estimated_survival_months: '',
    symptoms: []
  },
  trial_eligibility: {
    inclusion_met: [],
    exclusion_triggered: [],
    overall_judgment: 'uncertain'
  },
  _meta: {
    fields: {},
    sources: []
  }
};

function createPatientArchive(patientId = '') {
  const archive = clone(ARCHIVE_TEMPLATE);
  archive.patient_id = patientId;
  return archive;
}

function ensureMeta(archive) {
  if (!archive._meta) {
    archive._meta = { fields: {}, sources: [] };
  }
  archive._meta.fields = archive._meta.fields || {};
  archive._meta.sources = archive._meta.sources || [];
}

function shouldApply(value) {
  if (value === undefined || value === null) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value).length > 0;
  return true;
}

function mergeArraysUnique(target = [], incoming = [], key) {
  const result = [...(Array.isArray(target) ? target : [])];
  incoming.forEach((item) => {
    const serialized = key
      ? item?.[key]
      : typeof item === 'object'
        ? JSON.stringify(item)
        : item;
    const exists = result.some((existing) => {
      if (key) {
        return existing?.[key] === serialized;
      }
      if (typeof existing === 'object') {
        return JSON.stringify(existing) === serialized;
      }
      return existing === item;
    });
    if (!exists) {
      result.push(item);
    }
  });
  return result;
}

function recordMeta(archive, path, meta) {
  if (!meta) return;
  ensureMeta(archive);
  const existing = archive._meta.fields[path] || {};
  archive._meta.fields[path] = {
    ...existing,
    ...meta
  };
}

function setField(archive, path, value, options = {}) {
  if (!shouldApply(value)) return;
  const segments = path.split('.');
  let cursor = archive;
  for (let i = 0; i < segments.length - 1; i += 1) {
    const segment = segments[i];
    if (!cursor[segment] || typeof cursor[segment] !== 'object') {
      cursor[segment] = {};
    }
    cursor = cursor[segment];
  }
  const last = segments[segments.length - 1];

  if (Array.isArray(value)) {
    const existing = Array.isArray(cursor[last]) ? cursor[last] : [];
    cursor[last] = mergeArraysUnique(existing, value, options.arrayKey);
    return;
  }

  if (typeof value === 'object' && value !== null && !options.replaceObject) {
    const existing = cursor[last] && typeof cursor[last] === 'object' ? cursor[last] : {};
    cursor[last] = { ...existing, ...value };
    return;
  }

  cursor[last] = value;
}

function pushToArray(archive, path, entry, meta, dedupeKey) {
  if (!shouldApply(entry)) return;
  const segments = path.split('.');
  let cursor = archive;
  for (let i = 0; i < segments.length; i += 1) {
    const segment = segments[i];
    if (i === segments.length - 1) {
      if (!Array.isArray(cursor[segment])) {
        cursor[segment] = [];
      }
      const targetArray = cursor[segment];
      const exists = dedupeKey
        ? targetArray.some((item) => item && item[dedupeKey] && entry[dedupeKey] && item[dedupeKey] === entry[dedupeKey])
        : targetArray.some((item) => JSON.stringify(item) === JSON.stringify(entry));
      if (!exists) {
        targetArray.push(entry);
        if (meta) {
          recordMeta(archive, `${path}[${targetArray.length - 1}]`, meta);
        }
      }
      return;
    }
    if (!cursor[segment] || typeof cursor[segment] !== 'object') {
      cursor[segment] = {};
    }
    cursor = cursor[segment];
  }
}

function normalizeGender(value) {
  if (!value) return '';
  const normalized = String(value).toLowerCase();
  if (['male', 'm', '男'].includes(normalized)) return 'male';
  if (['female', 'f', '女'].includes(normalized)) return 'female';
  return value;
}

function addSymptom(archive, symptom, meta) {
  if (!symptom) return;
  ensureMeta(archive);
  archive.current_status.symptoms = archive.current_status.symptoms || [];
  if (!archive.current_status.symptoms.includes(symptom)) {
    archive.current_status.symptoms.push(symptom);
    if (meta) {
      recordMeta(archive, `current_status.symptoms[${archive.current_status.symptoms.length - 1}]`, meta);
    }
  }
}

function archiveToLegacyStructuredData(archive) {
  if (!archive) return {};
  const legacy = {
    diagnosis: archive.medical_history?.primary_diagnosis || '',
    stage: archive.pathology?.stage || '',
    mutations: Array.isArray(archive.pathology?.molecular_markers?.others?.genetic_mutations)
      ? archive.pathology.molecular_markers.others.genetic_mutations
          .map((m) => (m?.gene ? `${m.gene}:${m.status || ''}` : null))
          .filter(Boolean)
      : [],
    age: typeof archive.basic_info?.age === 'number' ? archive.basic_info.age : null,
    gender: normalizeGender(archive.basic_info?.gender || ''),
    previousTreatments: Array.isArray(archive.treatment_history)
      ? archive.treatment_history.map((t) => t.drug_or_procedure).filter(Boolean)
      : [],
    biomarkers: archive.lab_results?.tumor_markers || {},
    performanceStatus: archive.ecog_score ? `ECOG ${archive.ecog_score}` : '',
    measurableLesions: archive.current_status?.measurable_lesions ?? null
  };

  return legacy;
}

function ingestStepResult(archive, stepKey, payload, source) {
  if (!payload || !payload.data) return;
  const { data, confidence, reasoning, evidence } = payload;
  const meta = { source: `${source}.${stepKey}`, confidence, reasoning, evidence };

  switch (stepKey) {
    case 'step_1': {
      setField(archive, 'basic_info.age', data.age);
      recordMeta(archive, 'basic_info.age', meta);
      setField(archive, 'basic_info.gender', normalizeGender(data.gender));
      recordMeta(archive, 'basic_info.gender', meta);
      setField(archive, 'basic_info.ethnicity', data.ethnicity);
      recordMeta(archive, 'basic_info.ethnicity', meta);
      setField(archive, 'basic_info.height_cm', data.height_cm ?? data.height);
      recordMeta(archive, 'basic_info.height_cm', meta);
      setField(archive, 'basic_info.weight_kg', data.weight_kg ?? data.weight);
      recordMeta(archive, 'basic_info.weight_kg', meta);
      break;
    }
    case 'step_2': {
      setField(archive, 'medical_history.primary_diagnosis', data.primary_diagnosis);
      recordMeta(archive, 'medical_history.primary_diagnosis', meta);
      if (data.diagnosis_date) {
        setField(archive, 'medical_history.onset_date', data.diagnosis_date);
        recordMeta(archive, 'medical_history.onset_date', meta);
      }
      setField(archive, 'pathology.histology', data.pathology_type);
      recordMeta(archive, 'pathology.histology', meta);
      setField(archive, 'pathology.grade', data.grade);
      recordMeta(archive, 'pathology.grade', meta);
      const stageValue = data.staging_system || data.staging_value
        ? [data.staging_system, data.staging_value].filter(Boolean).join(' ')
        : '';
      setField(archive, 'pathology.stage', stageValue);
      recordMeta(archive, 'pathology.stage', meta);
      break;
    }
    case 'step_3': {
      setField(archive, 'medical_history.metastasis_sites', data.metastasis_sites || []);
      recordMeta(archive, 'medical_history.metastasis_sites', meta);
      if (data.measurable_lesions !== undefined) {
        setField(archive, 'current_status.measurable_lesions', data.measurable_lesions);
        recordMeta(archive, 'current_status.measurable_lesions', meta);
      }
      if (Array.isArray(data.bone_metastasis) && data.bone_metastasis.length) {
        data.bone_metastasis.forEach((item) => addSymptom(archive, `骨转移: ${item}`, meta));
      }
      if (data.ascites_pleural_effusion) {
        const { ascites, pleural_effusion } = data.ascites_pleural_effusion;
        if (ascites) addSymptom(archive, '腹水', meta);
        if (pleural_effusion) addSymptom(archive, '胸腔积液', meta);
      }
      break;
    }
    case 'step_4': {
      if (data.ecog_score !== undefined && data.ecog_score !== null) {
        setField(archive, 'ecog_score', String(data.ecog_score));
        recordMeta(archive, 'ecog_score', meta);
      }
      if (data.expected_survival_months !== undefined) {
        setField(archive, 'current_status.estimated_survival_months', String(data.expected_survival_months));
        recordMeta(archive, 'current_status.estimated_survival_months', meta);
      }
      if (data.functional_status_description) {
        addSymptom(archive, data.functional_status_description, meta);
      }
      break;
    }
    case 'step_5': {
      if (Array.isArray(data.surgical_history)) {
        data.surgical_history.forEach((entry) => {
          const treatment = {
            date: entry.date || '',
            therapy_type: 'surgery',
            drug_or_procedure: entry.procedure || '',
            cycles_or_dose: entry.pathology_stage || '',
            response_evaluation: entry.response || 'NA',
            side_effects: entry.complications || ''
          };
          pushToArray(archive, 'treatment_history', treatment, meta, 'date');
        });
      }
      if (Array.isArray(data.local_treatments)) {
        data.local_treatments.forEach((entry) => {
          const therapyType = ['放疗', 'γ刀', '射波刀'].includes(entry.type) ? 'radiotherapy' : 'other';
          const treatment = {
            date: entry.date_range || '',
            therapy_type: therapyType,
            drug_or_procedure: entry.type || '',
            cycles_or_dose: entry.dose || '',
            response_evaluation: entry.response || 'NA',
            side_effects: ''
          };
          pushToArray(archive, 'treatment_history', treatment, meta, 'date');
        });
      }
      break;
    }
    case 'step_6': {
      if (Array.isArray(data.systemic_treatments)) {
        data.systemic_treatments.forEach((treatment) => {
          const classes = Array.isArray(treatment.drug_classes) ? treatment.drug_classes : [];
          let therapyType = 'other';
          if (classes.includes('化疗')) therapyType = 'chemo';
          else if (classes.includes('免疫治疗')) therapyType = 'immunotherapy';
          else if (classes.includes('靶向治疗')) therapyType = 'targeted';
          else if (classes.includes('TKI')) therapyType = 'TKI';

          const entry = {
            date: treatment.start_date || '',
            therapy_type: therapyType,
            drug_or_procedure: Array.isArray(treatment.regimen) ? treatment.regimen.join(' + ') : '',
            cycles_or_dose: treatment.cycles != null ? `cycles: ${treatment.cycles}` : '',
            response_evaluation: treatment.best_response || 'NA',
            side_effects: Array.isArray(treatment.adverse_events) ? treatment.adverse_events.join('; ') : ''
          };
          pushToArray(archive, 'treatment_history', entry, meta, 'date');
        });
      }
      break;
    }
    case 'step_7': {
      if (data.lab_date) {
        setField(archive, 'lab_results.date', data.lab_date);
        recordMeta(archive, 'lab_results.date', meta);
      }
      if (data.blood_counts) {
        const mapping = {
          WBC: data.blood_counts.wbc,
          Neutrophils: data.blood_counts.anc ?? data.blood_counts.neutrophils,
          Platelets: data.blood_counts.platelet,
          Hemoglobin: data.blood_counts.hemoglobin
        };
        setField(archive, 'lab_results.blood_counts', mapping, { replaceObject: false });
        recordMeta(archive, 'lab_results.blood_counts', meta);
      }
      if (data.liver_function) {
        const mapping = {
          ALT: data.liver_function.alt,
          AST: data.liver_function.ast,
          TBIL: data.liver_function.tbil,
          Albumin: data.liver_function.alb ?? data.liver_function.albumin
        };
        setField(archive, 'lab_results.liver_function', mapping, { replaceObject: false });
        recordMeta(archive, 'lab_results.liver_function', meta);
      }
      if (data.kidney_function) {
        const mapping = {
          Creatinine: data.kidney_function.creatinine,
          Urea: data.kidney_function.bun ?? data.kidney_function.urea
        };
        setField(archive, 'lab_results.renal_function', mapping, { replaceObject: false });
        recordMeta(archive, 'lab_results.renal_function', meta);
      }
      if (Array.isArray(data.tumor_markers)) {
        data.tumor_markers.forEach((marker) => {
          if (!marker || !marker.marker) return;
          const key = marker.marker.toUpperCase();
          const value = marker.value != null ? String(marker.value) : marker.trend || '';
          setField(archive, `lab_results.tumor_markers.${key}`, value);
          recordMeta(archive, `lab_results.tumor_markers.${key}`, meta);
        });
      }
      break;
    }
    case 'step_8': {
      if (data.viral_hepatitis) {
        const { hbv_status, hcv_status } = data.viral_hepatitis;
        if (hbv_status) {
          setField(archive, 'medical_history.infection_status.HBV', hbv_status);
          recordMeta(archive, 'medical_history.infection_status.HBV', meta);
        }
        if (hcv_status) {
          setField(archive, 'medical_history.infection_status.HCV', hcv_status);
          recordMeta(archive, 'medical_history.infection_status.HCV', meta);
        }
      }
      if (data.other_infections && data.other_infections.hiv_status) {
        setField(archive, 'medical_history.infection_status.HIV', data.other_infections.hiv_status);
        recordMeta(archive, 'medical_history.infection_status.HIV', meta);
      }
      const comorbidities = [];
      if (data.cardiovascular) {
        Object.entries(data.cardiovascular).forEach(([key, value]) => {
          if (value === true) comorbidities.push(`心血管:${key}`);
        });
      }
      if (data.metabolic_disorders) {
        Object.entries(data.metabolic_disorders).forEach(([key, value]) => {
          if (value === true) comorbidities.push(`代谢:${key}`);
        });
      }
      if (Array.isArray(data.autoimmune_diseases)) {
        comorbidities.push(...data.autoimmune_diseases);
      }
      if (comorbidities.length) {
        const existing = archive.medical_history.comorbidities || [];
        const merged = mergeArraysUnique(existing, comorbidities);
        setField(archive, 'medical_history.comorbidities', merged);
        recordMeta(archive, 'medical_history.comorbidities', meta);
      }
      break;
    }
    case 'step_9': {
      if (Array.isArray(data.genetic_mutations) && data.genetic_mutations.length) {
        const others = archive.pathology.molecular_markers.others || {};
        others.genetic_mutations = data.genetic_mutations;
        setField(archive, 'pathology.molecular_markers.others', others, { replaceObject: true });
        recordMeta(archive, 'pathology.molecular_markers.others', meta);
      }
      if (data.msi_status) {
        setField(archive, 'pathology.molecular_markers.MSI_status', data.msi_status);
        recordMeta(archive, 'pathology.molecular_markers.MSI_status', meta);
      }
      if (data.tmb && data.tmb.value != null) {
        const value = `${data.tmb.value}${data.tmb.unit || ''}`;
        setField(archive, 'pathology.molecular_markers.TMB', value);
        recordMeta(archive, 'pathology.molecular_markers.TMB', meta);
      }
      if (data.pd_l1_status && data.pd_l1_status.value != null) {
        const value = `${data.pd_l1_status.value}${data.pd_l1_status.unit || ''}`;
        archive.pathology.molecular_markers['PD-L1'] = value;
        recordMeta(archive, "pathology.molecular_markers.PD-L1", meta);
      }
      break;
    }
    case 'step_10': {
      if (Array.isArray(data.severe_adverse_events)) {
        data.severe_adverse_events.forEach((event) => {
          if (event?.event) addSymptom(archive, `严重不良事件: ${event.event}`, meta);
        });
      }
      break;
    }
    case 'step_11': {
      if (data.special_conditions) {
        Object.entries(data.special_conditions).forEach(([key, value]) => {
          if (value) addSymptom(archive, `特殊情况:${key}`, meta);
        });
      }
      break;
    }
    default:
      break;
  }
}

function ingestStepwiseResults(archive, results, source = 'stepwise') {
  if (!results || typeof results !== 'object') return archive;
  Object.entries(results).forEach(([stepKey, payload]) => {
    if (payload && payload.success && payload.data) {
      ingestStepResult(archive, stepKey, payload, source);
    }
  });
  return archive;
}

function ingestLLMStructuredData(archive, structuredData, meta = {}) {
  if (!structuredData || typeof structuredData !== 'object') return archive;

  const sourceMeta = { source: meta.source || 'llm.integration', confidence: meta.confidence, reasoning: meta.reasoning };

  const profile = structuredData.patientProfile || {};
  const clinical = structuredData.clinicalInformation || {};
  const labs = structuredData.labSummary || structuredData.lab_results || {};
  const treatments = structuredData.treatmentHistory || structuredData.treatment_history || [];

  if (profile.name?.value) {
    setField(archive, 'basic_info.name', profile.name.value);
    recordMeta(archive, 'basic_info.name', sourceMeta);
  }
  if (profile.gender?.value) {
    setField(archive, 'basic_info.gender', normalizeGender(profile.gender.value));
    recordMeta(archive, 'basic_info.gender', sourceMeta);
  }
  if (profile.age?.value != null) {
    setField(archive, 'basic_info.age', profile.age.value);
    recordMeta(archive, 'basic_info.age', sourceMeta);
  }
  if (profile.history?.pastMedicalHistory) {
    const existing = archive.medical_history.comorbidities || [];
    const merged = mergeArraysUnique(existing, [profile.history.pastMedicalHistory]);
    setField(archive, 'medical_history.comorbidities', merged);
    recordMeta(archive, 'medical_history.comorbidities', sourceMeta);
  }
  if (clinical.pathology?.type) {
    setField(archive, 'pathology.histology', clinical.pathology.type);
    recordMeta(archive, 'pathology.histology', sourceMeta);
  }
  if (clinical.pathology?.grade) {
    setField(archive, 'pathology.grade', clinical.pathology.grade);
    recordMeta(archive, 'pathology.grade', sourceMeta);
  }
  if (clinical.staging) {
    const staging = clinical.staging.value || [clinical.staging.system, clinical.staging.value].filter(Boolean).join(' ');
    setField(archive, 'pathology.stage', staging);
    recordMeta(archive, 'pathology.stage', sourceMeta);
  }
  if (Array.isArray(treatments)) {
    treatments.forEach((treatment) => {
      const entry = {
        date: treatment.startDate || treatment.date || '',
        therapy_type: treatment.modality?.[0] || treatment.therapyType || 'other',
        drug_or_procedure: Array.isArray(treatment.regimen) ? treatment.regimen.join(' + ') : (treatment.drug_or_procedure || ''),
        cycles_or_dose: treatment.cycles_or_dose || '',
        response_evaluation: treatment.outcome || treatment.response || 'NA',
        side_effects: treatment.sideEffects || treatment.side_effects || ''
      };
      pushToArray(archive, 'treatment_history', entry, sourceMeta, 'date');
    });
  }
  if (labs.blood_counts) {
    setField(archive, 'lab_results.blood_counts', labs.blood_counts, { replaceObject: false });
    recordMeta(archive, 'lab_results.blood_counts', sourceMeta);
  }
  if (labs.liver_function) {
    setField(archive, 'lab_results.liver_function', labs.liver_function, { replaceObject: false });
    recordMeta(archive, 'lab_results.liver_function', sourceMeta);
  }
  if (labs.renal_function) {
    setField(archive, 'lab_results.renal_function', labs.renal_function, { replaceObject: false });
    recordMeta(archive, 'lab_results.renal_function', sourceMeta);
  }
  if (labs.tumor_markers) {
    Object.entries(labs.tumor_markers).forEach(([marker, value]) => {
      setField(archive, `lab_results.tumor_markers.${marker}`, value);
      recordMeta(archive, `lab_results.tumor_markers.${marker}`, sourceMeta);
    });
  }

  return archive;
}

function mergeArchives(target, source) {
  if (!source) return target;
  const merged = clone(target || ARCHIVE_TEMPLATE);
  const queue = [{ current: merged, incoming: source }];

  while (queue.length) {
    const { current, incoming } = queue.shift();
    if (!incoming) continue;

    Object.entries(incoming).forEach(([key, value]) => {
      if (key === '_meta') {
        ensureMeta(current);
        ensureMeta(incoming);
        current._meta.sources = mergeArraysUnique(current._meta.sources, incoming._meta.sources || []);
        current._meta.fields = { ...current._meta.fields, ...(incoming._meta?.fields || {}) };
        return;
      }

      if (Array.isArray(value)) {
        current[key] = mergeArraysUnique(current[key], value);
        return;
      }
      if (value && typeof value === 'object') {
        if (!current[key] || typeof current[key] !== 'object') {
          current[key] = Array.isArray(value) ? [] : {};
        }
        queue.push({ current: current[key], incoming: value });
        return;
      }
      if (shouldApply(value)) {
        current[key] = value;
      }
    });
  }

  return merged;
}

module.exports = {
  ARCHIVE_TEMPLATE,
  createPatientArchive,
  mergeArchives,
  ingestStepwiseResults,
  ingestLLMStructuredData,
  recordMeta,
  setField,
  archiveToLegacyStructuredData
};
