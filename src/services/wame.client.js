const { stripPhoneDigits } = require('../utils/phoneMatch');

const WAME_TIMEOUT_MS = 15_000;

function getServer() {
  return (process.env.WAME_SERVER || 'https://us.api-wa.me').replace(/\/$/, '');
}

/** @deprecated Env key is for migration only; runtime uses per-tenant keys. */
function getConfig() {
  return { server: getServer(), key: String(process.env.WAME_INSTANCE_KEY || '').trim() };
}

function assertInstanceKey(instanceKey) {
  const key = String(instanceKey || '').trim();
  if (!key) {
    const err = new Error(
      'Instância WhatsApp não configurada para esta clínica. Informe a instance key da WAME.'
    );
    err.statusCode = 503;
    err.code = 'WAME_NOT_CONFIGURED';
    throw err;
  }
  return { server: getServer(), key };
}

/** @deprecated Prefer assertInstanceKey(instanceKey). */
function assertConfigured() {
  return assertInstanceKey(process.env.WAME_INSTANCE_KEY);
}

function toInternationalPhone(phone) {
  let digits = stripPhoneDigits(phone);
  if (!digits) return '';
  if (digits.startsWith('55') && digits.length >= 12) return digits;
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  return digits;
}

function isNotConnectedMessage(message) {
  const lower = String(message || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  return (
    lower.includes('nao conectada') ||
    lower.includes('not connected') ||
    lower.includes('instance is not connected') ||
    lower.includes('reconecte') ||
    lower.includes('reconnect') ||
    (lower.includes('qr') && lower.includes('antes de'))
  );
}

/**
 * Erros da WAME NUNCA devem virar HTTP 401/403 na API do Gerenciei —
 * o frontend trata 401 como sessão expirada e desloga o usuário.
 */
function mapWameError(httpStatus, message, data) {
  const err = new Error(String(message || `WAME HTTP ${httpStatus}`));
  err.providerStatus = httpStatus;
  err.details = data;

  if (isNotConnectedMessage(message) || httpStatus === 401) {
    err.statusCode = 409;
    err.code = 'WAME_NOT_CONNECTED';
    if (!message || String(message).startsWith('WAME HTTP')) {
      err.message =
        'Instância WhatsApp não conectada. Reconecte via QR Code em Conexão antes de usar este recurso.';
    }
    return err;
  }

  if (httpStatus === 403) {
    err.statusCode = 502;
    err.code = 'WAME_API_ERROR';
    return err;
  }

  if (httpStatus === 429) {
    err.statusCode = 429;
    err.code = 'WAME_RATE_LIMIT';
    return err;
  }

  if (httpStatus >= 400 && httpStatus < 500) {
    err.statusCode = httpStatus;
    err.code = 'WAME_API_ERROR';
    return err;
  }

  err.statusCode = 502;
  err.code = 'WAME_API_ERROR';
  return err;
}

async function request(method, path, body, instanceKey) {
  const { server, key } = assertInstanceKey(instanceKey);
  const url = `${server}/${key}${path}`;
  const options = {
    method,
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(WAME_TIMEOUT_MS),
  };
  if (body !== undefined) {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(body);
  }

  let res;
  try {
    res = await fetch(url, options);
  } catch (error) {
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
      const err = new Error('Timeout ao falar com a WAME. Tente novamente.');
      err.statusCode = 504;
      err.code = 'WAME_TIMEOUT';
      throw err;
    }
    throw error;
  }

  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }

  if (!res.ok) {
    const message =
      data?.message ||
      data?.error ||
      data?.msg ||
      (typeof data === 'string' ? data : null) ||
      `WAME HTTP ${res.status}`;
    throw mapWameError(res.status, message, data);
  }

  return data;
}

function pickQr(payload) {
  if (!payload || typeof payload !== 'object') return null;
  const candidates = [
    payload.qrcode,
    payload.qrCode,
    payload.qr,
    payload.image,
    payload.base64,
    payload.data?.qrcode,
    payload.data?.qrCode,
    payload.data?.qr,
    payload.data?.image,
    payload.data?.base64,
    payload.instance?.qrcode,
    payload.instance?.qrCode,
    payload.instance?.image,
  ];
  for (const value of candidates) {
    if (typeof value === 'string' && value.trim()) {
      const raw = value.trim();
      if (raw.startsWith('data:')) return raw;
      if (raw.startsWith('http')) return raw;
      return `data:image/png;base64,${raw.replace(/^base64,/, '')}`;
    }
    if (value && typeof value === 'object') {
      const nested = value.base64 || value.data || value.code;
      if (typeof nested === 'string' && nested.trim()) {
        const raw = nested.trim();
        if (raw.startsWith('data:')) return raw;
        return `data:image/png;base64,${raw.replace(/^base64,/, '')}`;
      }
    }
  }
  return null;
}

function pickConnectedPhone(payload) {
  if (!payload || typeof payload !== 'object') return '';
  const user = payload.instance?.user || payload.user || {};
  const candidates = [
    payload.phone,
    payload.number,
    payload.owner,
    payload.wid,
    payload.me,
    user.id,
    user.jid,
    user.phone,
    payload.instance?.phone,
    payload.instance?.owner,
    payload.data?.phone,
    payload.data?.owner,
  ];
  for (const value of candidates) {
    if (typeof value === 'string' && value.trim()) {
      return stripPhoneDigits(value.split('@')[0]);
    }
    if (value && typeof value === 'object') {
      const nested = value.id || value.phone || value.user;
      if (typeof nested === 'string') {
        return stripPhoneDigits(nested.split('@')[0]);
      }
    }
  }
  return '';
}

function readConnectionFlags(payload) {
  const sources = [payload, payload?.instance, payload?.data].filter(
    (s) => s && typeof s === 'object'
  );
  let connected;
  let socket;
  let phoneConnected;
  for (const source of sources) {
    if (typeof source.connected === 'boolean' && connected === undefined) {
      connected = source.connected;
    }
    if (typeof source.socketConnection === 'number' && socket === undefined) {
      socket = source.socketConnection;
    }
    if (typeof source.phoneConnected === 'boolean' && phoneConnected === undefined) {
      phoneConnected = source.phoneConnected;
    }
  }
  return { connected, socket, phoneConnected };
}

/**
 * Status ao vivo da sessão.
 * Atenção: `phoneConnected` na WAME pode ficar true mesmo com socket morto
 * (`connected: false`, `socketConnection: 0`). Sinais de socket/connected
 * têm prioridade.
 */
function mapConnectionStatus(payload) {
  if (!payload || typeof payload !== 'object') return 'disconnected';

  const { connected, socket, phoneConnected } = readConnectionFlags(payload);
  const hasQr = Boolean(pickQr(payload));

  // Sinais positivos de sessão ao vivo têm prioridade (evita socket=0 transitório
  // ou phoneConnected stale sobrescrever connected=true).
  if (connected === true || socket === 1) {
    return 'connected';
  }
  if (connected === false || socket === 0) {
    return hasQr ? 'qr' : 'disconnected';
  }

  // Fallback legado: phoneConnected só quando não há flags de socket
  if (phoneConnected === true && connected === undefined && socket === undefined) {
    return 'connected';
  }
  if (phoneConnected === false) {
    return hasQr ? 'qr' : 'disconnected';
  }

  // WAME devolve status HTTP numérico (ex.: 200) no JSON — não é estado da sessão
  const rawCandidate =
    payload.state ||
    payload.connectionStatus ||
    payload.instance?.status ||
    payload.data?.status ||
    (typeof payload.status === 'string' ? payload.status : '');
  const raw = String(rawCandidate || '').toLowerCase();

  if (
    raw.includes('open') ||
    raw.includes('connected') ||
    raw.includes('ready') ||
    raw === 'online'
  ) {
    return 'connected';
  }

  if (hasQr || raw.includes('qr') || raw.includes('scan') || raw.includes('pairing')) {
    return 'qr';
  }

  if (raw.includes('close') || raw.includes('logout') || raw.includes('disconnect')) {
    return 'disconnected';
  }
  if (raw.includes('fail') || raw.includes('error')) {
    return 'failed';
  }
  return 'disconnected';
}

async function getInstance(instanceKey) {
  const data = await request('GET', '/instance', undefined, instanceKey);
  const status = mapConnectionStatus(data);
  return {
    raw: data,
    status,
    qr: status === 'qr' ? pickQr(data) : null,
    phone: pickConnectedPhone(data),
  };
}

async function connectInstance(instanceKey) {
  const data = await request('POST', '/instance', undefined, instanceKey);
  const mapped = mapConnectionStatus(data);
  const status = mapped === 'connected' ? 'connected' : 'qr';
  const qr = pickQr(data);
  if (status === 'qr' && !qr) {
    const err = new Error(
      'A WAME não retornou QR Code. Verifique a instância no painel ou tente novamente.'
    );
    err.statusCode = 502;
    err.code = 'WAME_NO_QR';
    err.details = data;
    throw err;
  }
  return {
    raw: data,
    status,
    qr,
    phone: pickConnectedPhone(data),
  };
}

async function disconnectInstance(instanceKey) {
  return request('DELETE', '/instance', undefined, instanceKey);
}

async function sendText(to, text, instanceKey) {
  const phone = toInternationalPhone(to);
  if (!phone) {
    const err = new Error('Telefone inválido para envio.');
    err.statusCode = 400;
    throw err;
  }
  return request('POST', '/message/text', { to: phone, text }, instanceKey);
}

module.exports = {
  getConfig,
  getServer,
  assertConfigured,
  assertInstanceKey,
  WAME_TIMEOUT_MS,
  toInternationalPhone,
  getInstance,
  connectInstance,
  disconnectInstance,
  sendText,
  pickQr,
  mapConnectionStatus,
  readConnectionFlags,
  isNotConnectedMessage,
  mapWameError,
};
