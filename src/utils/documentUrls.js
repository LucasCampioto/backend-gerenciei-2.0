/**
 * URLs de documento que ainda existem depois de fechar o navegador.
 * blob: e data: são locais/efêmeros e não devem ser persistidos nem usados no download.
 */
function isPersistableDocumentUrl(url) {
  if (!url || typeof url !== 'string') return false;
  const trimmed = url.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith('blob:') || trimmed.startsWith('data:')) return false;
  return trimmed.startsWith('https://') || trimmed.startsWith('http://');
}

function persistableOrEmpty(url) {
  return isPersistableDocumentUrl(url) ? url.trim() : '';
}

/**
 * URLs a gravar no Mongo depois do upload (S3) ou do body JSON.
 * Upload no S3 sempre vence blob:/data: enviados pelo front no momento da assinatura.
 */
function resolveStoredDocumentUrls({ uploadedLocation, fileUrl, signatureUrl } = {}) {
  const uploaded = persistableOrEmpty(uploadedLocation);
  const persistableFile = persistableOrEmpty(fileUrl);
  const persistableSignature = persistableOrEmpty(signatureUrl);

  const finalFileUrl = uploaded || persistableFile;
  const finalSignatureUrl = uploaded || persistableSignature || finalFileUrl;

  return {
    fileUrl: finalFileUrl,
    signatureUrl: finalSignatureUrl,
  };
}

function resolveDownloadUrl({ fileUrl, signatureUrl } = {}) {
  return persistableOrEmpty(signatureUrl) || persistableOrEmpty(fileUrl) || null;
}

function isTemplateObjectKey(key) {
  return typeof key === 'string' && key.startsWith('templates/');
}

function extractS3ObjectKey(url) {
  if (!isPersistableDocumentUrl(url) || !url.includes('amazonaws.com')) return null;
  try {
    const parsed = new URL(url);
    const key = parsed.pathname.replace(/^\/+/, '');
    return key || null;
  } catch (error) {
    return null;
  }
}

module.exports = {
  isPersistableDocumentUrl,
  resolveStoredDocumentUrls,
  resolveDownloadUrl,
  extractS3ObjectKey,
  isTemplateObjectKey,
};
