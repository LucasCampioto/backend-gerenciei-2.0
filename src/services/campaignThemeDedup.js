/**
 * Deduplicação de temas de campanha — evita repetir títulos/ângulos já usados pela clínica.
 */

function normalizeThemeLabel(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function themesAreSimilar(a, b) {
  const na = normalizeThemeLabel(a);
  const nb = normalizeThemeLabel(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.includes(nb) || nb.includes(na)) return true;
  const wa = new Set(na.split(' ').filter((w) => w.length > 3));
  const wb = new Set(nb.split(' ').filter((w) => w.length > 3));
  if (!wa.size && !wb.size) return false;
  const inter = [...wa].filter((w) => wb.has(w)).length;
  const union = new Set([...wa, ...wb]).size;
  return union > 0 && inter / union >= 0.7;
}

function uniqueLabels(labels) {
  const seen = [];
  const out = [];
  for (const raw of labels) {
    const label = String(raw || '').trim();
    if (!label) continue;
    if (seen.some((s) => themesAreSimilar(s, label))) continue;
    seen.push(label);
    out.push(label);
  }
  return out;
}

function filterDuplicateThemes(themes, usedEntries) {
  const used = (usedEntries || []).map((u) => (typeof u === 'string' ? u : u.label)).filter(Boolean);
  return (themes || []).filter((t) => {
    const title = t?.title || '';
    return !used.some((u) => themesAreSimilar(title, u));
  });
}

function filterDuplicateLabels(labels, usedEntries) {
  const used = (usedEntries || []).map((u) => (typeof u === 'string' ? u : u.label)).filter(Boolean);
  return (labels || []).filter((label) => !used.some((u) => themesAreSimilar(label, u)));
}

module.exports = {
  normalizeThemeLabel,
  themesAreSimilar,
  uniqueLabels,
  filterDuplicateThemes,
  filterDuplicateLabels,
};
