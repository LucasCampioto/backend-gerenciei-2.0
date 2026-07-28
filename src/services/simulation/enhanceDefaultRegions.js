/**
 * Regiões canônicas por `tipo_procedimento` (mesmo texto que vai em multipart).
 * Alinhado ao catálogo de procedimentos e demo pública — usado se `regioes` vier vazio.
 */

const BY_TIPO = {
  Botox: 'testa, glabela e região periorbital',
  'Preenchimento Labial': 'lábios e contorno dos lábios',
  'Contorno de Mandíbula': 'mandíbula, ângulos da mandíbula e perfil inferior',
  'Preenchimento Malar': 'maçãs do rosto e terço médio',
  Rinomodelação: 'nariz e dorso nasal',
  'Bigode chinês (sulco nasogeniano)': 'sulco nasogeniano e linhas ao redor do nariz e boca',
  'Preenchimento de mento (queixo)': 'mento e contorno anterior do queixo',
  'Preenchimento de olheira': 'região infra-orbitária, sulco palpebral inferior e olheiras',
  'Lipo HD': 'abdômen, flancos e definição de contornos corporais',
  Papada: 'região submentoniana, pescoço e transição cervical',
  'Lifting de braço': 'braços, terços médio e proximal e axilas',
  'Mamoplastia (prótese de silicone)': 'mamas',
  Rinoplastia: 'nariz, ponta nasal e dorso',
  'Otoplastia (orelha)': 'pavilhões auriculares e orelhas',
};

/** @returns {Record<string, string>} */
function enhanceDefaultRegionsByTipoNormalized() {
  /** @type {Record<string, string>} */
  const out = {};
  for (const [k, v] of Object.entries(BY_TIPO)) {
    const key = String(k).trim().toLowerCase();
    if (key) out[key] = v;
  }
  return out;
}

/** @param {string} tipo */
function lookupDefaultRegionForTipo(tipo) {
  const t = String(tipo || '').trim();
  if (!t) return '';
  const lk = enhanceDefaultRegionsByTipoNormalized()[t.toLowerCase()];
  return lk || '';
}

/**
 * Mantém texto enviado pelo cliente; se vazio, deriva pelos tipos multipart.
 * @param {string} clientRegioes
 * @param {string[]} tipos
 */
function resolveEnhanceRegioes(clientRegioes, tipos) {
  const trimmed = String(clientRegioes || '').trim();
  if (trimmed) return trimmed;
  const chunks = [];
  const seenNorm = new Set();
  for (const raw of tipos || []) {
    const lu = lookupDefaultRegionForTipo(raw);
    if (!lu) continue;
    const norm = lu.trim().toLowerCase();
    if (seenNorm.has(norm)) continue;
    seenNorm.add(norm);
    chunks.push(lu);
  }
  if (chunks.length) return chunks.join('; ');
  const tiposJoined = (tipos || [])
    .map((x) => String(x || '').trim())
    .filter(Boolean)
    .join('; ');
  if (tiposJoined) return `Áreas-alvo associadas aos procedimento(s): ${tiposJoined}.`;
  return '';
}

module.exports = {
  enhanceDefaultRegionsByTipoNormalized,
  lookupDefaultRegionForTipo,
  resolveEnhanceRegioes,
};
