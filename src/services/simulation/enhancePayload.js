/** Espelha chaves usadas no front (enhanceApi) para extrair imagem "after" do JSON do agente. */

/** Campos que costumam ser a saída processada (prioridade). */
const PREFERRED_BASE64_KEYS = [
  'enhanced_image_base64',
  'enhancedImageBase64',
  'image_base64',
  'imageBase64',
  'image_base64_data',
  'base64',
  'b64',
  'encoded_image',
  'content_base64',
  'png_base64',
];

/** Genéricos: muitos agentes repetem a entrada em `image` — só usar se não houver preferred. */
const FALLBACK_BASE64_KEYS = ['image', 'data', 'content'];

const PRIMARY_MIME_KEYS = [
  'enhanced_mime_type',
  'enhancedMimeType',
  'mime_type',
  'mimeType',
  'content_type',
  'contentType',
  'media_type',
];

const NEST_KEYS = ['data', 'result', 'payload', 'body', 'response', 'output'];

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function coerceToObject(raw) {
  let v = raw;
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') {
    const t = v.trim();
    if (!t) return null;
    try {
      v = JSON.parse(t);
    } catch {
      return null;
    }
  }
  if (Array.isArray(v) && v.length > 0 && isPlainObject(v[0])) return v[0];
  if (!isPlainObject(v)) return null;
  return v;
}

function pickStringField(d, keys) {
  for (const k of keys) {
    const val = d[k];
    if (typeof val === 'string' && val.trim()) return val;
  }
  return '';
}

function hasPreferredImageField(obj) {
  return Boolean(pickStringField(obj, PREFERRED_BASE64_KEYS));
}

const ALL_BASE64_KEYS = [...PREFERRED_BASE64_KEYS, ...FALLBACK_BASE64_KEYS];

function unwrapEnhancePayload(raw) {
  const root = coerceToObject(raw);
  if (!root) return null;
  if (hasPreferredImageField(root)) return root;
  for (const k of NEST_KEYS) {
    const inner = root[k];
    if (isPlainObject(inner) && hasPreferredImageField(inner)) return inner;
    if (Array.isArray(inner) && inner.length > 0 && isPlainObject(inner[0])) {
      const first = inner[0];
      if (hasPreferredImageField(first)) return first;
    }
  }
  if (pickStringField(root, ALL_BASE64_KEYS)) return root;
  for (const k of NEST_KEYS) {
    const inner = root[k];
    if (isPlainObject(inner) && pickStringField(inner, ALL_BASE64_KEYS)) return inner;
    if (Array.isArray(inner) && inner.length > 0 && isPlainObject(inner[0])) {
      const first = inner[0];
      if (pickStringField(first, ALL_BASE64_KEYS)) return first;
    }
  }
  return root;
}

const DATA_URL_RE = /^data:([^;]+);base64,(.+)$/i;

/**
 * @returns {{ buffer: Buffer, mime: string } | { error: string }}
 */
function extractAfterImageBuffer(agentData) {
  const d = unwrapEnhancePayload(agentData);
  if (!d) return { error: 'payload_invalido' };
  const rawB64 =
    pickStringField(d, PREFERRED_BASE64_KEYS) || pickStringField(d, FALLBACK_BASE64_KEYS);
  if (!rawB64.trim()) return { error: 'sem_imagem' };
  let b64 = rawB64.replace(/\s/g, '');
  let mime = pickStringField(d, PRIMARY_MIME_KEYS) || 'image/png';
  if (b64.startsWith('data:')) {
    const m = DATA_URL_RE.exec(b64);
    if (m) {
      mime = m[1].trim();
      b64 = m[2].replace(/\s/g, '');
    }
  }
  try {
    const buffer = Buffer.from(b64, 'base64');
    if (!buffer.length) return { error: 'base64_invalido' };
    return { buffer, mime };
  } catch {
    return { error: 'base64_invalido' };
  }
}

module.exports = { extractAfterImageBuffer };
