function clamp(number, min, max) {
  return Math.max(min, Math.min(max, number));
}

function snippetAround(text, index, length, contextChars = 32) {
  if (!text || typeof text !== 'string') return null;
  if (!Number.isFinite(index) || index < 0) return null;
  const len = Number.isFinite(length) ? Math.max(0, length) : 0;
  const context = Number.isFinite(contextChars) ? Math.max(0, contextChars) : 32;
  const start = clamp(index - context, 0, text.length);
  const end = clamp(index + len + context, 0, text.length);
  const raw = text.slice(start, end).replace(/\s+/g, ' ').trim();
  return raw || null;
}

function firstRegexEvidence(text, regex, contextChars = 32) {
  if (!text || typeof text !== 'string') return null;
  if (!(regex instanceof RegExp)) return null;
  const match = regex.exec(text);
  if (!match) return null;
  const index = typeof match.index === 'number' ? match.index : text.indexOf(match[0]);
  return snippetAround(text, index, (match[0] || '').length, contextChars);
}

function firstSubstringEvidence(text, needle, contextChars = 32) {
  if (!text || typeof text !== 'string') return null;
  if (!needle || typeof needle !== 'string') return null;
  const index = text.indexOf(needle);
  if (index < 0) return null;
  return snippetAround(text, index, needle.length, contextChars);
}

module.exports = {
  snippetAround,
  firstRegexEvidence,
  firstSubstringEvidence
};

