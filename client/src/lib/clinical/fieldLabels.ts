export const FIELD_LABELS: Record<string, string> = {
  name: '姓名',
  patient_id: '患者ID',
  patientId: '患者ID',
  age: '年龄',
  gender: '性别',
  primary_diagnosis: '主要诊断',
  diagnosis: '诊断',
  stage: '分期',
  staging: '分期',
  staging_system: '分期系统',
  staging_value: '分期值',
  pathology: '病理',
  histology: '组织学类型',
  grade: '分级',
  mvi_grade: 'MVI 分级',
  biomarkers: '生物标志物',
  mutations: '基因突变',
  systemic_treatments: '系统治疗',
  previousTreatments: '既往治疗',
  treatment_history: '治疗史',
  total_treatment_lines: '治疗线数',
  last_treatment_date: '最近治疗日期',
  lab_values: '实验室检查',
  lab_results: '检验结果',
  blood_counts: '血常规',
  liver_function: '肝功能',
  renal_function: '肾功能',
  tumor_markers: '肿瘤标志物',
  performance_status: '体能状态',
  performanceStatus: '体能状态',
  ecog_score: 'ECOG 评分',
  kps_score: 'KPS 评分',
  current_status: '当前状态',
  measurable_lesions: '可测量病灶',
  measurableLesions: '可测量病灶',
  organ_function_ok: '脏器功能良好',
  estimated_survival_months: '预期生存（月）',
  medical_history: '病史',
  basic_info: '基本信息',
};

function toSnakeCase(input: string): string {
  return input
    .replace(/\./g, '_')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[-\s]+/g, '_')
    .toLowerCase();
}

function beautifyKey(input: string): string {
  return input
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .trim();
}

export function getFieldLabel(key: string): string {
  const raw = (key ?? '').trim();
  if (!raw) return '';

  if (FIELD_LABELS[raw]) return FIELD_LABELS[raw];

  const dottedLeaf = raw.split('.').filter(Boolean).pop();
  if (dottedLeaf && dottedLeaf !== raw) return getFieldLabel(dottedLeaf);

  const snake = toSnakeCase(raw);
  if (FIELD_LABELS[snake]) return FIELD_LABELS[snake];

  const lower = raw.toLowerCase();
  if (FIELD_LABELS[lower]) return FIELD_LABELS[lower];

  return beautifyKey(raw);
}

