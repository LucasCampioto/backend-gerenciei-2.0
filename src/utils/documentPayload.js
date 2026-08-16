/**
 * Regras de create/listagem de Document — origem, data do papel, signatário.
 */

const DOCUMENT_ORIGINS = ['digital_signature', 'physical_scan'];

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeOrigin(value) {
  if (value == null || value === '') return 'digital_signature';
  if (DOCUMENT_ORIGINS.includes(value)) return value;
  return null;
}

function parseSignedAt(value) {
  if (value == null || value === '') return undefined;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  const raw = String(value).trim();
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (dateOnly) {
    const date = new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]));
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function endOfDay(date) {
  const end = new Date(date);
  end.setHours(23, 59, 59, 999);
  return end;
}

function physicalScanError({ origin, clientId, signedAt }) {
  if (origin !== 'physical_scan') return null;
  if (!clientId) return 'Paciente é obrigatório para ficha física';
  if (!signedAt) return 'Data da assinatura no papel é obrigatória';
  return null;
}

function resolveSignerFields({ origin, client, userName, userEmail }) {
  const email = typeof userEmail === 'string' && userEmail.includes('@')
    ? userEmail.trim().toLowerCase()
    : undefined;

  if (origin === 'physical_scan' && client) {
    return {
      userName: client.name,
      userEmail: email,
    };
  }

  return {
    userName: typeof userName === 'string' ? userName.trim() : userName,
    userEmail: email,
  };
}

function digitalSignatureError({ origin, userName, userEmail, clientId }) {
  if (origin === 'physical_scan') return null;
  if (!userName || !String(userName).trim()) return 'Nome do usuário é obrigatório';
  if (!clientId && !userEmail) return 'Email do usuário é obrigatório';
  return null;
}

function originListQuery(origin) {
  if (origin === 'digital_signature') {
    return {
      $or: [
        { origin: 'digital_signature' },
        { origin: { $exists: false } },
        { origin: null },
      ],
    };
  }
  return { origin };
}

function buildDocumentListParts({ origin, search, startDate, endDate } = {}) {
  const parts = [];
  const normalizedOrigin = origin ? normalizeOrigin(origin) : null;
  if (origin && !normalizedOrigin) {
    return { error: 'origin inválido', parts: [] };
  }
  if (normalizedOrigin && origin) {
    parts.push(originListQuery(normalizedOrigin));
  }

  if (search && String(search).trim()) {
    const rx = { $regex: escapeRegex(String(search).trim()), $options: 'i' };
    parts.push({
      $or: [
        { fileName: rx },
        { userName: rx },
        { userEmail: rx },
        { title: rx },
      ],
    });
  }

  const signedAt = {};
  if (startDate) {
    const start = parseSignedAt(startDate);
    if (start === null) return { error: 'startDate inválida', parts: [] };
    if (start) signedAt.$gte = start;
  }
  if (endDate) {
    const end = parseSignedAt(endDate);
    if (end === null) return { error: 'endDate inválida', parts: [] };
    if (end) signedAt.$lte = endOfDay(end);
  }
  if (Object.keys(signedAt).length > 0) {
    parts.push({ signedAt });
  }

  return { error: null, parts };
}

module.exports = {
  DOCUMENT_ORIGINS,
  normalizeOrigin,
  parseSignedAt,
  physicalScanError,
  digitalSignatureError,
  resolveSignerFields,
  originListQuery,
  buildDocumentListParts,
};
