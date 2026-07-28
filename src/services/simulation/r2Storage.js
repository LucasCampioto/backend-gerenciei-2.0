const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

/**
 * Endpoint S3 da R2: https://<ACCOUNT_ID>.r2.cloudflarestorage.com
 * (substitua pelo ID real da conta Cloudflare, sem < >).
 */
function getNormalizedR2Endpoint() {
  const raw = (process.env.R2_ENDPOINT || '').trim();
  if (!raw) return null;
  if (/[<>]/.test(raw)) {
    console.warn(
      '[R2] R2_ENDPOINT inválido: o texto <account_id> no .env.example é só exemplo. ' +
        'Cole o ID real da conta (só letras e números), ex.: https://a1b2c3d4e5f6789abcdef01234567890.r2.cloudflarestorage.com',
    );
    return null;
  }
  let u;
  try {
    u = new URL(raw);
  } catch {
    console.warn('[R2] R2_ENDPOINT não é uma URL válida. Use https:// + account_id + .r2.cloudflarestorage.com');
    return null;
  }
  if (u.protocol !== 'https:') {
    console.warn('[R2] R2_ENDPOINT deve usar https://');
    return null;
  }
  return u.href.replace(/\/$/, '');
}

function endpointHostForLog() {
  const ep = getNormalizedR2Endpoint();
  if (!ep) return '(endpoint ausente ou inválido — veja aviso [R2] acima)';
  try {
    return new URL(ep).host;
  } catch {
    return '(URL do endpoint inválida)';
  }
}

function logR2AccessDeniedHint() {
  console.error(
    '[R2] AccessDenied (403): credenciais ou escopo do token não permitem PutObject neste bucket. Confira:\n' +
      '  • Token criado em R2 → Manage R2 API Tokens (compatível S3), com permissão de escrita (ex.: Object Read & Write).\n' +
      '  • R2_BUCKET_NAME igual ao nome do bucket na mesma conta Cloudflare do R2_ENDPOINT.\n' +
      '  • Se o token for restrito a bucket(s), inclua exatamente este bucket.\n' +
      '  • Access Key ID + Secret são do mesmo token; tokens só de leitura geram 403 no upload.',
  );
}

function logR2SignatureMismatchHint() {
  console.error(
    '[R2] SignatureDoesNotMatch: a assinatura não bate com o Secret. Quase sempre é cópia errada do .env:\n' +
      '  • Cole de novo o Secret Access Key completo (só aparece uma vez ao criar o token).\n' +
      '  • Access Key ID e Secret devem ser do MESMO token R2 (não misturar dois tokens).\n' +
      '  • Uma linha só, sem espaço no início/fim; evite aspas no .env (ou use aspas envolvendo o valor inteiro).\n' +
      '  • Não use o “Global API Key” da Cloudflare — só chaves do “Manage R2 API Tokens”.',
  );
}

function logR2UnauthorizedHint() {
  console.error(
    '[R2] Unauthorized (401): as credenciais foram recusadas (antes ou além da assinatura). Confira:\n' +
      '  • Access Key ID existe e não foi revogado: R2 → Manage R2 API Tokens (não confundir com API Token do perfil).\n' +
      '  • R2_ENDPOINT usa o Account ID da MESMA conta Cloudflare em que o token e o bucket foram criados.\n' +
      '  • Secret Access Key completo, do mesmo token que o Access Key ID (regenerar token se perdeu o secret).\n' +
      '  • Nada de variável vazia ou comentário na mesma linha do .env (ex.: valor#comentário corta o secret).',
  );
}

/** Remove espaços, aspas externas e BOM comuns em .env. */
function sanitizeR2Credential(raw) {
  if (raw == null) return '';
  let s = String(raw).trim();
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1).trim();
  if (
    (s.startsWith('"') && s.endsWith('"') && s.length >= 2) ||
    (s.startsWith("'") && s.endsWith("'") && s.length >= 2)
  ) {
    s = s.slice(1, -1).trim();
  }
  return s;
}

function logR2Error(context, err, extra = {}) {
  const code = err?.Code ?? err?.code;
  const status = err?.$metadata?.httpStatusCode;
  console.error(`[R2] ${context}`, {
    ...extra,
    message: err?.message,
    name: err?.name,
    code,
    httpStatusCode: status,
    requestId: err?.$metadata?.requestId,
    cfId: err?.$metadata?.cfId,
  });
  if (code === 'AccessDenied' || err?.name === 'AccessDenied') {
    logR2AccessDeniedHint();
  }
  if (code === 'SignatureDoesNotMatch' || err?.name === 'SignatureDoesNotMatch') {
    logR2SignatureMismatchHint();
  }
  if (
    code === 'Unauthorized' ||
    err?.name === 'Unauthorized' ||
    status === 401
  ) {
    logR2UnauthorizedHint();
  }
}

function getClient() {
  const endpoint = getNormalizedR2Endpoint();
  const accessKeyId = sanitizeR2Credential(process.env.R2_ACCESS_KEY_ID);
  const secretAccessKey = sanitizeR2Credential(process.env.R2_SECRET_ACCESS_KEY);
  if (!endpoint || !accessKeyId || !secretAccessKey) return null;
  return new S3Client({
    region: 'auto',
    endpoint,
    credentials: { accessKeyId, secretAccessKey },
  });
}

function getBucket() {
  return (process.env.R2_BUCKET_NAME || '').trim() || '';
}

function isR2Configured() {
  return Boolean(getClient() && getBucket());
}

/**
 * @param {string} key
 * @param {Buffer} buffer
 * @param {string} contentType
 */
async function putObject(key, buffer, contentType) {
  const client = getClient();
  const Bucket = getBucket();
  if (!client || !Bucket) {
    console.warn('[R2] putObject abortado: cliente S3 ou R2_BUCKET_NAME ausente');
    throw new Error('R2 não configurado');
  }
  const bytes = buffer?.length ?? 0;
  console.log('[R2] putObject iniciando', {
    key,
    bytes,
    bucket: Bucket,
    endpointHost: endpointHostForLog(),
    contentType: contentType || 'application/octet-stream',
  });
  try {
    await client.send(
      new PutObjectCommand({
        Bucket,
        Key: key,
        Body: buffer,
        ContentType: contentType || 'application/octet-stream',
      }),
    );
    console.log('[R2] putObject ok', key);
  } catch (err) {
    logR2Error('putObject falhou', err, { key, bucket: Bucket });
    throw err;
  }
}

/**
 * URL pública se R2_PUBLIC_BASE_URL estiver definida.
 * Em `*.r2.dev` o subdomínio já está ligado ao bucket — a key vai direto no path
 * (`https://pub-xxx.r2.dev/<key>`), sem repetir o nome do bucket.
 */
function publicObjectUrl(key) {
  const baseRaw = (process.env.R2_PUBLIC_BASE_URL || '').trim();
  if (!baseRaw) return null;
  const baseNoTrail = baseRaw.replace(/\/$/, '');
  let u;
  try {
    u = new URL(baseNoTrail);
  } catch {
    console.warn('[R2] R2_PUBLIC_BASE_URL não é uma URL válida');
    return null;
  }
  const encodedKey = key.split('/').map((seg) => encodeURIComponent(seg)).join('/');
  const pathPrefix = u.pathname === '/' ? '' : u.pathname.replace(/\/$/, '');
  return `${u.origin}${pathPrefix}/${encodedKey}`;
}

/**
 * Lê o objeto do bucket (sem passar por URL pública; evita CORS no download pelo browser).
 * @param {string} key
 * @returns {Promise<{ buffer: Buffer, contentType: string }>}
 */
async function getObjectBuffer(key) {
  const client = getClient();
  const Bucket = getBucket();
  if (!client || !Bucket) {
    throw new Error('R2 não configurado');
  }
  const out = await client.send(
    new GetObjectCommand({ Bucket, Key: key }),
  );
  if (!out.Body) {
    throw new Error('Objeto vazio no R2');
  }
  const chunks = [];
  for await (const chunk of out.Body) {
    chunks.push(chunk);
  }
  const buffer = Buffer.concat(chunks);
  const contentType = (out.ContentType || '').trim() || 'application/octet-stream';
  return { buffer, contentType };
}

async function presignedGetUrl(key, expiresIn = 900) {
  const client = getClient();
  const Bucket = getBucket();
  if (!client || !Bucket) throw new Error('R2 não configurado');
  const cmd = new GetObjectCommand({ Bucket, Key: key });
  try {
    const url = await getSignedUrl(client, cmd, { expiresIn });
    console.log('[R2] presignedGetUrl ok', { key, expiresIn });
    return url;
  } catch (err) {
    logR2Error('presignedGetUrl falhou', err, { key, expiresIn });
    throw err;
  }
}

/** URL pública ou presigned conforme env. */
async function resolveReadUrl(key) {
  const pub = publicObjectUrl(key);
  if (pub) {
    console.log('[R2] resolveReadUrl usando URL pública', { key, hasBase: Boolean(process.env.R2_PUBLIC_BASE_URL) });
    return pub;
  }
  console.log('[R2] resolveReadUrl gerando URL assinada', { key });
  return presignedGetUrl(key, Number(process.env.R2_SIGNED_URL_TTL_SECONDS) || 900);
}

module.exports = {
  isR2Configured,
  putObject,
  publicObjectUrl,
  getObjectBuffer,
  presignedGetUrl,
  resolveReadUrl,
};
