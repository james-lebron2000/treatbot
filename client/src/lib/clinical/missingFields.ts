import type { FieldPromptConfig } from '@/lib/api/medical';
import type { JsonValue } from '@/types';

export type MissingChecklist = {
  requiredFields?: string[];
  trialIntents?: string[];
};

export type MissingFieldItem = {
  id: string;
  label: string;
  source: 'required' | 'trial';
  fieldConfig?: FieldPromptConfig;
  manual?: {
    key: string; // dotted key
    type: 'text' | 'number' | 'boolean' | 'array';
    placeholder?: string;
  };
};

export const REQUIRED_FIELD_DEFS: Record<string, Omit<MissingFieldItem, 'id' | 'source'>> = {
  primary_diagnosis: {
    label: '主要诊断',
    fieldConfig: 'primary_diagnosis',
    manual: { key: 'primary_diagnosis', type: 'text', placeholder: '例如：肝细胞癌' }
  },
  staging_value: {
    label: '分期',
    fieldConfig: 'staging_value',
    manual: { key: 'staging_value', type: 'text', placeholder: '例如：CNLC IIIb / ypT3N0M0' }
  },
  age: {
    label: '年龄',
    fieldConfig: 'age',
    manual: { key: 'age', type: 'number', placeholder: '岁' }
  },
  gender: {
    label: '性别',
    fieldConfig: 'gender',
    manual: { key: 'gender', type: 'text', placeholder: '男 / 女' }
  },
  ecog_score: {
    label: 'ECOG',
    fieldConfig: 'ecog_score',
    manual: { key: 'ecog_score', type: 'number', placeholder: '0-4' }
  },
  metastasis_sites: {
    label: '转移部位',
    fieldConfig: 'metastasis_sites',
    manual: { key: 'metastasis_sites', type: 'array', placeholder: '用逗号分隔，例如：肺,骨' }
  },
  measurable_lesions: {
    label: '可测量病灶',
    fieldConfig: {
      key: 'measurable_lesions',
      type: 'boolean',
      prompt: '判断是否存在 RECIST 可测量病灶。若未提及请返回 null；若明确存在/不存在请返回 true/false。'
    },
    manual: { key: 'measurable_lesions', type: 'boolean' }
  },
  hbv_status: {
    label: '乙肝状态(HBV)',
    fieldConfig: 'viral_hepatitis.hbv_status',
    manual: { key: 'viral_hepatitis.hbv_status', type: 'text', placeholder: '例如：HBsAg阳性 / 阴性 / 既往感染' }
  },
  treatments: {
    label: '既往系统治疗',
    fieldConfig: {
      key: 'systemic_treatments',
      type: 'array',
      prompt: '提取既往系统抗肿瘤治疗方案，返回数组。可返回药物/方案名称字符串数组；若未提及返回空数组。'
    },
    manual: { key: 'systemic_treatments', type: 'array', placeholder: '用逗号分隔，例如：信迪利单抗,仑伐替尼' }
  }
};

export const TRIAL_INTENT_DEFS: Record<string, Omit<MissingFieldItem, 'id' | 'source'>> = {
  therapy_history: REQUIRED_FIELD_DEFS.treatments,
  age: REQUIRED_FIELD_DEFS.age,
  gender: REQUIRED_FIELD_DEFS.gender,
  ecog: REQUIRED_FIELD_DEFS.ecog_score,
  measurable: REQUIRED_FIELD_DEFS.measurable_lesions,
  hbv: REQUIRED_FIELD_DEFS.hbv_status,
  pregnancy: {
    label: '妊娠/哺乳状态',
    fieldConfig: { key: 'pregnancy_status', type: 'string', prompt: '提取妊娠/哺乳状态（妊娠/哺乳/非妊娠非哺乳）。若未提及返回 null。' },
    manual: { key: 'pregnancy_status', type: 'text', placeholder: '妊娠 / 哺乳 / 非妊娠非哺乳' }
  },
  platelet: {
    label: '血小板(PLT)',
    fieldConfig: { key: 'lab_results.blood_counts.platelets', type: 'number', prompt: '提取最新血小板(PLT)数值（×10^9/L），只返回数字；若未提及返回 null。' },
    manual: { key: 'lab_results.blood_counts.platelets', type: 'number' }
  },
  hemoglobin: {
    label: '血红蛋白(Hb)',
    fieldConfig: { key: 'lab_results.blood_counts.hemoglobin', type: 'number', prompt: '提取最新血红蛋白(Hb)数值（g/L），只返回数字；若未提及返回 null。' },
    manual: { key: 'lab_results.blood_counts.hemoglobin', type: 'number' }
  },
  neutrophil: {
    label: '中性粒细胞(ANC)',
    fieldConfig: { key: 'lab_results.blood_counts.anc', type: 'number', prompt: '提取最新中性粒细胞绝对值(ANC)（×10^9/L），只返回数字；若未提及返回 null。' },
    manual: { key: 'lab_results.blood_counts.anc', type: 'number' }
  },
  alt: {
    label: 'ALT',
    fieldConfig: { key: 'lab_results.liver_function.alt', type: 'number', prompt: '提取最新 ALT 数值（U/L），只返回数字；若未提及返回 null。' },
    manual: { key: 'lab_results.liver_function.alt', type: 'number' }
  },
  ast: {
    label: 'AST',
    fieldConfig: { key: 'lab_results.liver_function.ast', type: 'number', prompt: '提取最新 AST 数值（U/L），只返回数字；若未提及返回 null。' },
    manual: { key: 'lab_results.liver_function.ast', type: 'number' }
  },
  bilirubin: {
    label: '总胆红素(TBIL)',
    fieldConfig: { key: 'lab_results.liver_function.tbil', type: 'number', prompt: '提取最新总胆红素(TBIL)数值（µmol/L），只返回数字；若未提及返回 null。' },
    manual: { key: 'lab_results.liver_function.tbil', type: 'number' }
  },
  creatinine: {
    label: '肌酐(Cr)',
    fieldConfig: { key: 'lab_results.kidney_function.creatinine', type: 'number', prompt: '提取最新肌酐(Creatinine)数值（µmol/L），只返回数字；若未提及返回 null。' },
    manual: { key: 'lab_results.kidney_function.creatinine', type: 'number' }
  },
  urea: {
    label: '尿素(Urea)',
    fieldConfig: { key: 'lab_results.kidney_function.urea', type: 'number', prompt: '提取最新尿素(Urea)数值（mmol/L），只返回数字；若未提及返回 null。' },
    manual: { key: 'lab_results.kidney_function.urea', type: 'number' }
  }
};

export function buildMissingItems(missingChecklist: MissingChecklist | null | undefined): MissingFieldItem[] {
  const requiredFields = missingChecklist?.requiredFields || [];
  const trialIntents = missingChecklist?.trialIntents || [];
  const items: MissingFieldItem[] = [];

  requiredFields.forEach((key) => {
    const def = REQUIRED_FIELD_DEFS[key];
    items.push({
      id: `required:${key}`,
      source: 'required',
      label: def?.label || key,
      fieldConfig: def?.fieldConfig,
      manual: def?.manual
    });
  });

  trialIntents.forEach((intent) => {
    const def = TRIAL_INTENT_DEFS[intent];
    items.push({
      id: `trial:${intent}`,
      source: 'trial',
      label: def?.label || intent,
      fieldConfig: def?.fieldConfig,
      manual: def?.manual
    });
  });

  return items;
}

type JsonObject = Record<string, JsonValue>;

function isJsonObject(value: JsonValue | undefined): value is JsonObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function getDottedValue(root: JsonValue | undefined, dottedKey: string): JsonValue | undefined {
  if (!dottedKey) return undefined;
  const parts = dottedKey.split('.').filter(Boolean);
  if (!parts.length) return undefined;
  let cursor: JsonValue | undefined = root;
  for (const part of parts) {
    if (!isJsonObject(cursor)) return undefined;
    cursor = cursor[part] as JsonValue | undefined;
  }
  return cursor;
}

export function formatJsonValueForInput(value: JsonValue | undefined): string {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) {
    return value.map((v) => formatJsonValueForInput(v as JsonValue)).filter(Boolean).join(', ');
  }
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return '';
    }
  }
  return String(value);
}

export function getItemKeyForLookup(item: MissingFieldItem): string | null {
  if (item.manual?.key) return item.manual.key;
  if (typeof item.fieldConfig === 'string') return item.fieldConfig;
  if (item.fieldConfig && typeof item.fieldConfig === 'object' && typeof item.fieldConfig.key === 'string') return item.fieldConfig.key;
  return null;
}
