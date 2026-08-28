/** Normaliza nome para comparação (acentos, case, pontuação, espaços). */
function normalizeName(value = '') {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/ç/g, 'c')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function namesAreEqual(a, b) {
  const left = normalizeName(a);
  const right = normalizeName(b);
  return Boolean(left) && left === right;
}

/**
 * Busca lead/cliente com o mesmo nome normalizado na clínica.
 * @param {import('mongoose').Model} Client
 * @param {string|import('mongoose').Types.ObjectId} userId
 * @param {string} name
 * @param {{ excludeId?: string|import('mongoose').Types.ObjectId }} [opts]
 */
async function findClientByNormalizedName(Client, userId, name, opts = {}) {
  const normalized = normalizeName(name);
  if (!normalized) return null;

  const query = { userId };
  if (opts.excludeId) {
    query._id = { $ne: opts.excludeId };
  }

  const clients = await Client.find(query).select('_id name phone category').lean();
  return clients.find((client) => normalizeName(client.name) === normalized) || null;
}

module.exports = {
  normalizeName,
  namesAreEqual,
  findClientByNormalizedName,
};
