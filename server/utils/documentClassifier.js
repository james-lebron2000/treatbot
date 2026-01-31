function normalizeText(value) {
  return String(value || '').replace(/\r\n/g, '\n');
}

const DOCUMENT_TYPES = [
  { type: 'discharge_summary', patterns: [/出院记录/, /出院小结/, /出院诊断/, /入院诊断/, /出院医嘱/] },
  { type: 'pathology', patterns: [/病理/, /组织学/, /免疫组化/, /HE染色/i, /分化/, /MVI/i, /标本/] },
  { type: 'lab_report', patterns: [/检验/, /血常规/, /生化/, /肝功能/, /肾功能/, /凝血/, /结果[:：]/] },
  { type: 'imaging_report', patterns: [/影像/, /CT/i, /MRI/i, /PET/i, /超声/, /增强扫描/, /报告[:：]/] },
  { type: 'treatment_record', patterns: [/治疗经过/, /化疗/, /免疫/, /靶向/, /放疗/, /手术/, /用药/, /处方/] },
  { type: 'progress_note', patterns: [/病程记录/, /查房记录/, /主诉/, /现病史/, /既往史/] }
];

function scoreType(text, patterns) {
  let score = 0;
  patterns.forEach((pattern) => {
    if (pattern.test(text)) score += 1;
  });
  return score;
}

function classifyDocument(text) {
  const normalized = normalizeText(text);
  const trimmed = normalized.trim();
  if (!trimmed) {
    return {
      primaryType: 'unknown',
      types: [],
      confidence: 'low',
      signals: [],
      length: 0
    };
  }

  const signals = [];
  const scored = DOCUMENT_TYPES.map((entry) => {
    const score = scoreType(trimmed, entry.patterns);
    if (score > 0) {
      signals.push({ type: entry.type, score });
    }
    return { type: entry.type, score };
  }).filter((entry) => entry.score > 0);

  scored.sort((a, b) => b.score - a.score);
  const primary = scored[0]?.type || 'unknown';

  const confidence = (() => {
    if (!scored.length) return 'low';
    if (scored[0].score >= 3) return 'high';
    if (scored[0].score >= 2) return 'medium';
    return 'low';
  })();

  return {
    primaryType: primary,
    types: scored.map((entry) => entry.type),
    confidence,
    signals,
    length: trimmed.length
  };
}

module.exports = {
  classifyDocument
};

