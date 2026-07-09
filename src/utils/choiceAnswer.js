function isOtherAnswer(value) {
  return value && typeof value === 'object' && value.other === true;
}

function formatChoiceDisplayValue(value) {
  if (isOtherAnswer(value)) {
    return value.text?.trim() ? `Outro: ${value.text.trim()}` : 'Outro';
  }
  if (Array.isArray(value)) {
    return value.map(formatChoiceDisplayValue).filter(Boolean).join(', ');
  }
  if (value === null || value === undefined) return '';
  return String(value);
}

function isChoiceAnswerEmpty(value) {
  if (value === null || value === undefined || value === '') return true;
  if (Array.isArray(value)) return value.length === 0;
  if (isOtherAnswer(value)) return !value.text?.trim();
  return false;
}

function normalizeChoiceForAnalytics(value, otherLabel = 'Outro') {
  if (isOtherAnswer(value)) {
    return otherLabel;
  }
  return String(value);
}

module.exports = {
  isOtherAnswer,
  formatChoiceDisplayValue,
  isChoiceAnswerEmpty,
  normalizeChoiceForAnalytics,
};
