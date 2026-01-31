const logger = require('../utils/logger');
const { normalizePatientArchive, toNumber } = require('./patientProfileAdapter');

function firstDefined(...candidates) {
  for (const value of candidates) {
    if (value === undefined || value === null) {
      continue;
    }
    if (typeof value === 'string' && value.trim().length === 0) {
      continue;
    }
    return value;
  }
  return undefined;
}

function normalizeGender(input) {
  if (!input) return null;
  const text = String(input).trim().toLowerCase();
  if (!text) return null;
  if (/^(m|male|man|男)/.test(text)) {
    return 'male';
  }
  if (/^(f|female|woman|女)/.test(text)) {
    return 'female';
  }
  if (/不适用|unknown|未/.test(text)) {
    return null;
  }
  return text;
}

function cleanArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value
      .map((item) => (item == null ? '' : String(item).trim()))
      .filter((item) => item.length > 0);
  }
  return [String(value).trim()].filter(Boolean);
}

function ensureNumber(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const parsed = toNumber(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function extractNested(object, paths = []) {
  for (const path of paths) {
    if (!Array.isArray(path)) {
      throw new Error('extractNested path must be array of keys');
    }
    let current = object;
    let found = true;
    for (const key of path) {
      if (current && Object.prototype.hasOwnProperty.call(current, key)) {
        current = current[key];
      } else {
        found = false;
        break;
      }
    }
    if (found) {
      return current;
    }
  }
  return undefined;
}

function normaliseStructuredPatient(raw = {}) {
  const basics = extractNested(raw, [
    ['basicInfo'],
    ['basic_info'],
    ['基本信息'],
    ['demographics']
  ]) || {};

  const diagnosisSection = extractNested(raw, [
    ['diagnosis'],
    ['疾病信息'],
    ['疾病'],
    ['medicalHistory']
  ]) || {};

  const statusSection = extractNested(raw, [
    ['status'],
    ['current_status'],
    ['currentStatus'],
    ['体能状态'],
    ['现病史']
  ]) || {};

  const labsSection = extractNested(raw, [
    ['lab_results'],
    ['labResults'],
    ['labs'],
    ['实验室检查']
  ]) || {};

  const infectionSection = extractNested(raw, [
    ['infection'],
    ['感染'],
    ['medicalHistory', 'infection_status'],
    ['medical_history', 'infection_status']
  ]) || {};

  const biomarkerSection = extractNested(raw, [
    ['pathology', 'molecular_markers'],
    ['分子标志物'],
    ['molecular_testing'],
    ['molecularTesting'],
    ['biomarkers']
  ]) || {};

  const therapySection = extractNested(raw, [
    ['treatments'],
    ['治疗史'],
    ['treatmentHistory'],
    ['treatment_history']
  ]) || {};

  const baseAge = firstDefined(
    basics.age,
    basics.Age,
    basics.年龄,
    raw.age,
    raw.patient_age,
    raw['年龄'],
    raw['age']
  );

  const ageValue = ensureNumber(baseAge);

  const genderValue = normalizeGender(firstDefined(
    basics.gender,
    basics.Gender,
    basics.性别,
    raw.gender,
    raw.sex,
    raw['性别']
  ));

  const stageValue = firstDefined(
    diagnosisSection.stage,
    diagnosisSection.Stage,
    diagnosisSection.分期,
    diagnosisSection.stage_text,
    raw.stage,
    raw.staging_value,
    raw['分期']
  );

  const diagnosisList = cleanArray(firstDefined(
    diagnosisSection.diagnosis,
    diagnosisSection.diagnoses,
    diagnosisSection.诊断,
    raw.primary_diagnosis,
    raw.primaryDiagnosis,
    raw.diagnosis,
    raw['诊断']
  ));

  const primaryDiagnosis = diagnosisList[0] || (typeof diagnosisSection === 'string' ? diagnosisSection : null);

  const diseaseLabels = cleanArray(firstDefined(
    diagnosisSection.disease_labels,
    diagnosisSection.三级标签,
    diagnosisSection['三级标签'],
    raw.disease_labels,
    raw.疾病三级标签,
    raw.diseaseLabels,
    raw.disease_tags
  ));

  const ecogRaw = firstDefined(
    statusSection.ecog,
    statusSection.ecog_score,
    statusSection.ECOG,
    statusSection['ECOG'],
    statusSection['ECOG评分'],
    raw.ecog_score,
    raw.ECOG,
    raw['ECOG'],
    raw['体能状态']
  );

  const ecogScore = ensureNumber(ecogRaw);

  const survivalRaw = firstDefined(
    statusSection.estimated_survival,
    statusSection.estimated_survival_months,
    statusSection['预期生存期'],
    raw.estimated_survival,
    raw.estimated_survival_months
  );

  const organFunctionOk = (() => {
    const value = firstDefined(
      statusSection.organ_function_ok,
      statusSection.organFunctionOk,
      statusSection['器官功能'],
      raw.organ_function_ok,
      raw.organFunctionOk
    );
    if (value === undefined) return null;
    if (typeof value === 'boolean') return value;
    const text = String(value).trim();
    if (!text) return null;
    if (/良好|正常|y|yes|true|合格/.test(text)) return true;
    if (/不全|异常|n|no|false/.test(text)) return false;
    return null;
  })();

  const measurable = (() => {
    const value = firstDefined(
      statusSection.measurableLesions,
      statusSection.measurable_lesions,
      statusSection['可测量病灶'],
      raw.measurable_lesions,
      raw.measurableLesions
    );
    if (value === undefined || value === null) return null;
    if (typeof value === 'boolean') return value;
    const text = String(value).trim();
    if (!text) return null;
    if (/有|存在|yes|y|true/.test(text)) return true;
    if (/无|未|否|no|false/.test(text)) return false;
    return null;
  })();

  const pregnancyStatus = firstDefined(
    statusSection.pregnancy_status,
    statusSection.妊娠,
    statusSection.pregnancy,
    raw.pregnancy_status,
    raw['妊娠']
  );

  const labBlood = extractNested(labsSection, [
    ['blood_counts'],
    ['bloodCounts'],
    ['血常规']
  ]) || {};

  const labLiver = extractNested(labsSection, [
    ['liver_function'],
    ['liverFunction'],
    ['肝功能']
  ]) || {};

  const labRenal = extractNested(labsSection, [
    ['kidney_function'],
    ['renal_function'],
    ['renalFunction'],
    ['肾功能']
  ]) || {};

  const labCoagulation = extractNested(labsSection, [
    ['coagulation'],
    ['凝血功能']
  ]) || {};

  const labTumor = extractNested(labsSection, [
    ['tumor_markers'],
    ['tumorMarkers'],
    ['肿瘤标志物']
  ]) || {};

  const hbvStatus = firstDefined(
    infectionSection.hbv,
    infectionSection.HBV,
    infectionSection.hbv_status,
    infectionSection.HBV_status,
    infectionSection['HBV'],
    infectionSection['HBV状态'],
    raw.hbv_status,
    raw.HBV_status,
    raw['HBV']
  );

  const hcvStatus = firstDefined(
    infectionSection.hcv,
    infectionSection.HCV,
    infectionSection.hcv_status,
    infectionSection.HCV_status,
    raw.hcv_status,
    raw['HCV']
  );

  const hivStatus = firstDefined(
    infectionSection.hiv,
    infectionSection.HIV,
    infectionSection.hiv_status,
    infectionSection.HIV_status,
    raw.hiv_status,
    raw['HIV']
  );

  const systemicTreatments = (() => {
    const list = [];
    const treatmentArrays = [
      therapySection.systemic_treatments,
      therapySection.systemicTreatments,
      therapySection.系统治疗,
      therapySection.化疗,
      therapySection.靶向治疗,
      therapySection.免疫治疗,
      raw.systemic_treatments,
      raw.previous_treatments,
      raw.treatments
    ].filter(Boolean);

    treatmentArrays.forEach((entry) => {
      if (!entry) return;
      if (Array.isArray(entry)) {
        entry.forEach((item) => {
          if (!item) return;
          if (typeof item === 'string') {
            list.push({
              name: item,
              line: null,
              type: null
            });
            return;
          }
          list.push({
            name: item.name || item.drug || item.drug_or_procedure || item.medication || item.therapy || item.regimen || '',
            type: item.type || item.therapy_type || item.category || null,
            line: item.line || item.line_of_therapy || item.lineNumber || null
          });
        });
        return;
      }
      list.push({
        name: String(entry).trim(),
        type: null,
        line: null
      });
    });
    return list.filter((item) => item.name);
  })();

  const biomarkerEntries = (() => {
    const result = {};
    Object.entries(biomarkerSection).forEach(([key, value]) => {
      if (value === undefined || value === null) return;
      const normalizedKey = String(key).trim();
      if (!normalizedKey) return;
      result[normalizedKey] = String(value).trim();
    });
    return result;
  })();

  const metastasisSites = cleanArray(firstDefined(
    statusSection.metastasis_sites,
    statusSection.metastasisSites,
    statusSection['转移部位'],
    raw.metastasis_sites,
    raw['转移']
  ));

  const comorbidities = cleanArray(firstDefined(
    raw.comorbidities,
    diagnosisSection.comorbidities,
    raw['合并症']
  ));

  return {
    demographics: {
      age: ageValue,
      ageRaw: baseAge == null ? '' : String(baseAge).trim(),
      gender: genderValue,
      genderRaw: firstDefined(
        basics.gender,
        basics.Gender,
        basics.性别,
        raw.gender,
        raw.sex,
        raw['性别']
      ) || ''
    },
    diagnosis: {
      primary: primaryDiagnosis || '',
      allDiagnoses: diagnosisList,
      stage: stageValue ? String(stageValue).trim() : '',
      diseaseLabels,
      histology: firstDefined(
        diagnosisSection.histology,
        diagnosisSection['病理类型'],
        raw.pathology_type,
        raw['病理类型']
      ) || ''
    },
    performance: {
      ecog: ecogScore,
      ecogRaw: ecogRaw == null ? '' : String(ecogRaw).trim(),
      survivalMonths: ensureNumber(survivalRaw)
    },
    status: {
      organFunctionOk,
      measurableLesions: measurable,
      pregnancyStatus: pregnancyStatus == null ? '' : String(pregnancyStatus).trim(),
      metastasisSites
    },
    labs: {
      blood: {
        wbc: ensureNumber(firstDefined(labBlood.wbc, labBlood.WBC, labBlood['白细胞'])),
        anc: ensureNumber(firstDefined(labBlood.anc, labBlood.ANC, labBlood.neutrophils, labBlood.Neutrophils, labBlood['中性粒细胞'])),
        hemoglobin: ensureNumber(firstDefined(labBlood.hemoglobin, labBlood.HGB, labBlood['血红蛋白'])),
        platelets: ensureNumber(firstDefined(labBlood.platelets, labBlood.PLT, labBlood['血小板']))
      },
      liver: {
        alt: ensureNumber(firstDefined(labLiver.alt, labLiver.ALT, labLiver['ALT'], labLiver['丙氨酸氨基转移酶'])),
        ast: ensureNumber(firstDefined(labLiver.ast, labLiver.AST, labLiver['AST'], labLiver['天门冬氨酸氨基转移酶'])),
        albumin: ensureNumber(firstDefined(labLiver.albumin, labLiver['白蛋白'])),
        bilirubin: ensureNumber(firstDefined(labLiver.tbil, labLiver.TBIL, labLiver['总胆红素']))
      },
      renal: {
        creatinine: ensureNumber(firstDefined(labRenal.creatinine, labRenal['肌酐'], labRenal.Creatinine)),
        urea: ensureNumber(firstDefined(labRenal.urea, labRenal['尿素'], labRenal.Urea))
      },
      coagulation: {
        inr: ensureNumber(firstDefined(labCoagulation.inr, labCoagulation.INR)),
        fib: ensureNumber(firstDefined(labCoagulation.fib, labCoagulation.FIB, labCoagulation['纤维蛋白原']))
      },
      tumorMarkers: {
        afp: ensureNumber(firstDefined(labTumor.afp, labTumor.AFP, labTumor['甲胎蛋白'])),
        cea: ensureNumber(firstDefined(labTumor.cea, labTumor.CEA, labTumor['癌胚抗原'])),
        ca199: ensureNumber(firstDefined(labTumor.ca199, labTumor.CA199, labTumor['CA19-9'], labTumor['糖类抗原19-9']))
      }
    },
    infections: {
      hbv: hbvStatus == null ? '' : String(hbvStatus).trim(),
      hcv: hcvStatus == null ? '' : String(hcvStatus).trim(),
      hiv: hivStatus == null ? '' : String(hivStatus).trim()
    },
    biomarkers: biomarkerEntries,
    treatments: {
      systemic: systemicTreatments,
      previousLines: ensureNumber(firstDefined(raw.total_treatment_lines, raw.treatment_lines, raw['治疗线数']))
    },
    comorbidities
  };
}

function canonicalFromArchive(archive) {
  const normalized = normalizePatientArchive(archive);
  const canonical = normaliseStructuredPatient(normalized);
  return { canonical, source: 'clinical-archive' };
}

function canonicalFromStructured(raw) {
  const canonical = normaliseStructuredPatient(raw);
  return { canonical, source: 'structured-json' };
}

function buildLegacyPatientView(canonical, source) {
  const blood = canonical.labs.blood || {};
  const liver = canonical.labs.liver || {};
  const renal = canonical.labs.renal || {};

  return {
    source,
    age: canonical.demographics.age,
    gender: canonical.demographics.gender,
    primary_diagnosis: canonical.diagnosis.primary,
    diagnosis_list: canonical.diagnosis.allDiagnoses,
    staging_value: canonical.diagnosis.stage,
    disease_labels: canonical.diagnosis.diseaseLabels,
    pathology_type: canonical.diagnosis.histology,
    ecog_score: canonical.performance.ecog,
    estimated_survival_months: canonical.performance.survivalMonths,
    organ_function_ok: canonical.status.organFunctionOk,
    measurable_lesions: canonical.status.measurableLesions,
    pregnancy_status: canonical.status.pregnancyStatus,
    metastasis_sites: canonical.status.metastasisSites,
    blood_counts: {
      wbc: blood.wbc,
      anc: blood.anc,
      hemoglobin: blood.hemoglobin,
      platelet: blood.platelets
    },
    liver_function: {
      alt: liver.alt,
      ast: liver.ast,
      albumin: liver.albumin,
      tbil: liver.bilirubin
    },
    kidney_function: {
      creatinine: renal.creatinine,
      urea: renal.urea
    },
    coagulation: canonical.labs.coagulation,
    tumor_markers: canonical.labs.tumorMarkers,
    viral_hepatitis: {
      hbv_status: canonical.infections.hbv,
      hcv_status: canonical.infections.hcv,
      hiv_status: canonical.infections.hiv
    },
    molecular_testing: canonical.biomarkers,
    previous_treatments: canonical.treatments.systemic,
    total_treatment_lines: canonical.treatments.previousLines,
    comorbidities: canonical.comorbidities,
    __canonical: canonical
  };
}

function collectWarnings(canonical) {
  const warnings = [];
  if (canonical.demographics.age == null) warnings.push('age missing');
  if (!canonical.demographics.gender) warnings.push('gender missing');
  if (!canonical.diagnosis.primary) warnings.push('primary diagnosis missing');
  if (!canonical.diagnosis.stage) warnings.push('staging value missing');
  if (canonical.performance.ecog == null) warnings.push('ECOG score missing');
  return warnings;
}

function normaliseRecordForMatching(record) {
  if (!record) {
    return null;
  }
  if (record.__normalizedForMatching) {
    return record.__normalizedForMatching;
  }

  let dataSource = null;
  let canonical;
  let source;
  if (record.clinicalArchive) {
    ({ canonical, source } = canonicalFromArchive(record.clinicalArchive));
    dataSource = source;
  } else if (record.llmIntegrationData?.fullStructuredData) {
    ({ canonical, source } = canonicalFromStructured(record.llmIntegrationData.fullStructuredData));
    dataSource = `${source}:llm`;
  } else if (record.structuredData && Object.keys(record.structuredData).length > 0) {
    ({ canonical, source } = canonicalFromStructured(record.structuredData));
    dataSource = `${source}:legacy`;
  } else {
    return null;
  }

  const legacy = buildLegacyPatientView(canonical, dataSource);
  const warnings = collectWarnings(canonical);
  if (warnings.length > 0) {
    logger.warn({ patientId: record.patientId || record._id, warnings }, 'Patient structured data missing core fields');
  }

  const normalized = {
    legacy,
    canonical,
    warnings,
    source: dataSource
  };

  Object.defineProperty(record, '__normalizedForMatching', {
    value: normalized,
    enumerable: false,
    configurable: true
  });

  return normalized;
}

module.exports = {
  normaliseRecordForMatching
};
