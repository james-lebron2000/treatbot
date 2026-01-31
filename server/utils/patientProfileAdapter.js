function safeString(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function valueFromCandidates(source, candidates) {
  if (!source) return {};
  for (const key of candidates) {
    if (source[key] && typeof source[key] === 'object') {
      return source[key];
    }
  }
  return {};
}

function normalizeLabValue(group, keys) {
  for (const key of keys) {
    if (group[key] !== undefined && group[key] !== null && group[key] !== '') {
      return { value: toNumber(group[key]), raw: safeString(group[key]) };
    }
  }
  return { value: null, raw: '' };
}

function differenceInYears(later, earlier) {
  if (!(later instanceof Date) || Number.isNaN(later.getTime())) return null;
  if (!(earlier instanceof Date) || Number.isNaN(earlier.getTime())) return null;
  const diff = later.getFullYear() - earlier.getFullYear();
  const hasPastBirthday = (later.getMonth() > earlier.getMonth())
    || (later.getMonth() === earlier.getMonth() && later.getDate() >= earlier.getDate());
  return hasPastBirthday ? diff : diff - 1;
}

function toNumber(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const text = String(value).replace(/,/g, '').trim();
  if (!text) return null;

  const sciMatch = text.match(/(-?\d+(?:\.\d+)?)\s*[×x]\s*10\^?(-?\d+)/i);
  if (sciMatch) {
    const base = Number(sciMatch[1]);
    const power = Number(sciMatch[2]);
    if (Number.isFinite(base) && Number.isFinite(power)) {
      return base * (10 ** power);
    }
  }

  const simpleMatch = text.match(/-?\d+(?:\.\d+)?(?:[eE][+\-]?\d+)?/);
  if (!simpleMatch) return null;

  const parsed = Number(simpleMatch[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

function computeAge(basicInfo) {
  const ageRaw = safeString(basicInfo?.age);
  if (ageRaw) {
    const parsed = toNumber(ageRaw);
    if (parsed !== null) {
      return { value: parsed, raw: ageRaw.includes('岁') ? ageRaw : `${parsed}岁` };
    }
  }

  const dob = safeString(basicInfo?.date_of_birth);
  if (!dob) {
    return { value: null, raw: '' };
  }

  const dobDate = new Date(dob);
  if (Number.isNaN(dobDate.getTime())) {
    return { value: null, raw: dob };
  }

  const ageYears = differenceInYears(new Date(), dobDate);
  if (ageYears === null) {
    return { value: null, raw: dob };
  }
  return { value: ageYears, raw: `${ageYears}岁` };
}

function normalizeLabs(labSection) {
  const labs = labSection || {};
  const blood = valueFromCandidates(labs, ['blood_counts', 'bloodCounts', 'blood', 'cbc', 'hematology', '血常规']);
  const liver = valueFromCandidates(labs, ['liver_function', 'liverFunction', 'hepatic', '肝功能']);
  const renal = valueFromCandidates(labs, ['renal_function', 'renalFunction', 'kidney', '肾功能']);
  const tumor = valueFromCandidates(labs, ['tumor_markers', 'tumorMarkers', 'oncology', '肿瘤标志物']);

  return {
    wbc: normalizeLabValue(blood, ['WBC', 'wbc', '白细胞']),
    neutrophils: normalizeLabValue(blood, ['Neutrophils', 'neutrophils', 'ANC', '中性粒细胞']),
    platelets: normalizeLabValue(blood, ['Platelets', 'platelets', 'PLT', '血小板']),
    hemoglobin: normalizeLabValue(blood, ['Hemoglobin', 'hemoglobin', 'HGB', '血红蛋白']),
    alt: normalizeLabValue(liver, ['ALT', 'alt', '丙氨酸氨基转移酶']),
    ast: normalizeLabValue(liver, ['AST', 'ast', '天门冬氨酸氨基转移酶']),
    tBil: normalizeLabValue(liver, ['TBIL', 'tbil', '总胆红素']),
    albumin: normalizeLabValue(liver, ['Albumin', 'albumin', '白蛋白']),
    creatinine: normalizeLabValue(renal, ['Creatinine', 'creatinine', '肌酐']),
    urea: normalizeLabValue(renal, ['Urea', 'urea', '尿素']),
    afp: normalizeLabValue(tumor, ['AFP', 'afp', '甲胎蛋白']),
    cea: normalizeLabValue(tumor, ['CEA', 'cea', '癌胚抗原']),
    ca199: normalizeLabValue(tumor, ['CA199', 'ca199', '糖类抗原19-9']),
    pivka: normalizeLabValue(tumor, ['PIVKA-II', 'pivka', 'PIVKAII'])
  };
}

function extractLabSection(archive) {
  if (archive.lab_results) return archive.lab_results;
  if (archive.labResults) return archive.labResults;
  if (archive.labs) return archive.labs;
  if (archive['实验室检查']) return archive['实验室检查'];
  return {};
}

function normalizePatientArchive(clinicalArchive = {}) {
  const basicInfo = clinicalArchive.basic_info || clinicalArchive.basicInfo || {};
  const medicalHistory = clinicalArchive.medical_history || clinicalArchive.medicalHistory || {};
  const pathology = clinicalArchive.pathology || {};
  const currentStatus = clinicalArchive.current_status || clinicalArchive.currentStatus || {};

  const age = computeAge(basicInfo);
  const ecogRaw = safeString(clinicalArchive.ecog_score);
  const ecogValue = ecogRaw ? toNumber(ecogRaw) : null;

  const survivalRaw = safeString(currentStatus.estimated_survival_months);

  return {
    patientId: safeString(clinicalArchive.patient_id),
    demographics: {
      name: safeString(basicInfo.name),
      gender: safeString(basicInfo.gender).toLowerCase(),
      age,
      dob: safeString(basicInfo.date_of_birth),
      visitDate: safeString(basicInfo.visit_date)
    },
    diagnosis: {
      primary: safeString(medicalHistory.primary_diagnosis),
      stage: safeString(pathology.stage),
      histology: safeString(pathology.histology)
    },
    pathology: {
      molecule: pathology.molecular_markers || {}
    },
    infection: {
      hbv: safeString(medicalHistory.infection_status?.HBV),
      hcv: safeString(medicalHistory.infection_status?.HCV),
      hiv: safeString(medicalHistory.infection_status?.HIV)
    },
    comorbidities: Array.isArray(medicalHistory.comorbidities) ? medicalHistory.comorbidities.map(safeString) : [],
    previousMalignancies: Array.isArray(medicalHistory.previous_malignancies) ? medicalHistory.previous_malignancies.map(safeString) : [],
    treatments: Array.isArray(clinicalArchive.treatment_history || clinicalArchive.treatmentHistory)
      ? (clinicalArchive.treatment_history || clinicalArchive.treatmentHistory).map((item) => ({
        date: safeString(item.date),
        therapyType: safeString(item.therapy_type),
        name: safeString(item.drug_or_procedure),
        cyclesOrDose: safeString(item.cycles_or_dose),
        response: safeString(item.response_evaluation),
        sideEffects: safeString(item.side_effects)
      })) : [],
    labs: normalizeLabs(extractLabSection(clinicalArchive)),
    status: {
      measurableLesions: Boolean(currentStatus.measurable_lesions),
      organFunctionOk: currentStatus.organ_function_ok !== undefined ? Boolean(currentStatus.organ_function_ok) : null,
      estimatedSurvival: {
        value: survivalRaw ? toNumber(survivalRaw) : null,
        raw: survivalRaw
      },
      symptoms: Array.isArray(currentStatus.symptoms) ? currentStatus.symptoms.map(safeString) : []
    },
    ecog: {
      value: Number.isFinite(ecogValue) ? ecogValue : null,
      raw: ecogRaw
    }
  };
}

module.exports = {
  normalizePatientArchive,
  toNumber
};
