const DEFAULT_MODE = 'full';

const MODES = new Set(['full', 'redact', 'disallow']);

function getLLMPrivacyMode() {
  const mode = String(process.env.LLM_PHI_MODE || DEFAULT_MODE).trim().toLowerCase();
  return MODES.has(mode) ? mode : DEFAULT_MODE;
}

function redactWithRules(text) {
  if (!text) return '';
  let output = String(text);

  // Identifiers
  output = output.replace(/(?:身份证号|身份证|ID\s*No\.?|ID号)[:：]?\s*([0-9]{15}[0-9Xx]|[0-9]{17}[0-9Xx])/g, '身份证号: [REDACTED_ID]');
  output = output.replace(/(?:病案号|住院号|门诊号|就诊号|患者ID|病历号|医保号|社保号)[:：]?\s*([A-Za-z0-9\-]{5,})/g, (match) => match.replace(/[:：]\s*([A-Za-z0-9\-]{5,})/, ': [REDACTED_ID]'));

  // Contact
  output = output.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[REDACTED_EMAIL]');
  output = output.replace(/(?:电话|手机|联系方式|联系电话)[:：]?\s*(\+?\d[\d\s\-]{6,}\d)/g, (match) => match.replace(/(\+?\d[\d\s\-]{6,}\d)/, '[REDACTED_PHONE]'));
  output = output.replace(/\b(1[3-9]\d)\s*[-\s]?\d{4}\s*[-\s]?\d{4}\b/g, '[REDACTED_PHONE]');

  // Names (only when explicitly labeled)
  output = output.replace(/(?:姓名|Name)[:：]?\s*([A-Za-z\u4e00-\u9fff·]{2,32})/g, (match) => match.replace(/[:：]\s*([A-Za-z\u4e00-\u9fff·]{2,32})/, ': [REDACTED_NAME]'));
  output = output.replace(/(?:患者|病人)[:：]?\s*([A-Za-z\u4e00-\u9fff·]{2,32})/g, (match) => match.replace(/[:：]\s*([A-Za-z\u4e00-\u9fff·]{2,32})/, ': [REDACTED_NAME]'));
  output = output.replace(/(?:家属|联系人|紧急联系人)[:：]?\s*([A-Za-z\u4e00-\u9fff·]{2,32})/g, (match) => match.replace(/[:：]\s*([A-Za-z\u4e00-\u9fff·]{2,32})/, ': [REDACTED_NAME]'));

  // Addresses (heuristic; keep conservative to avoid destroying clinical info)
  output = output.replace(/(?:地址|住址|现住址)[:：]?\s*([^\n]{6,80})/g, (match) => match.replace(/[:：]\s*([^\n]{6,80})/, ': [REDACTED_ADDRESS]'));

  // Bed/ward identifiers (low risk but can be identifying in small units)
  output = output.replace(/(?:病区|病房|床号|床位)[:：]?\s*([A-Za-z0-9\-]{1,16})/g, (match) => match.replace(/[:：]\s*([A-Za-z0-9\-]{1,16})/, ': [REDACTED_LOCATION]'));

  return output;
}

function prepareTextForLLM(text) {
  const mode = getLLMPrivacyMode();
  if (mode === 'disallow') {
    const err = new Error('LLM PHI mode disallows sending raw medical text to third-party models');
    err.code = 'llm_phi_disallowed';
    throw err;
  }
  // Production safety: never send direct identifiers to third-party models.
  // `full` keeps maximum clinical content but still applies conservative identifier redaction.
  return redactWithRules(text);
}

function sanitizePatientDataForLLM(input) {
  const mode = getLLMPrivacyMode();
  if (mode === 'disallow') {
    const err = new Error('LLM PHI mode disallows sending patient data to third-party models');
    err.code = 'llm_phi_disallowed';
    throw err;
  }

  const sensitiveKeys = new Set([
    'name',
    'patient_name',
    '姓名',
    'phone',
    'mobile',
    'email',
    'address',
    '住址',
    '现住址',
    'contactInfo',
    '联系方式',
    '身份证',
    '身份证号',
    'idCard',
    'id_number',
    'patientId',
    'patient_id',
    '病案号',
    '住院号',
    '门诊号',
    '就诊号',
    '病历号'
  ]);

  const walk = (value) => {
    if (value === null || value === undefined) return value;
    if (typeof value === 'string') {
      // Redact identifiers that may appear inside string fields.
      return redactWithRules(value);
    }
    if (typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.map(walk);

    const output = {};
    Object.entries(value).forEach(([key, val]) => {
      if (sensitiveKeys.has(key)) {
        return;
      }
      output[key] = walk(val);
    });
    return output;
  };

  return walk(input);
}

module.exports = {
  getLLMPrivacyMode,
  prepareTextForLLM,
  sanitizePatientDataForLLM
};
