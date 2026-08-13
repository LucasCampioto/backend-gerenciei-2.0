/**
 * Quando o par já está no R2, o JSON não precisa carregar megabytes de base64 —
 * o browser trava no parse e a tela de resultado demora a abrir.
 */
function stripInlineImagesIfR2(out) {
  if (!out || typeof out !== 'object' || Array.isArray(out)) return out;
  const pairId = typeof out.pairId === 'string' && out.pairId.trim();
  const originalUrl = typeof out.r2_original_url === 'string' && out.r2_original_url.trim();
  const afterUrl = typeof out.r2_after_url === 'string' && out.r2_after_url.trim();
  if (!pairId || !originalUrl || !afterUrl) return out;

  const copy = { ...out };
  delete copy.enhanced_image_base64;
  delete copy.enhancedImageBase64;
  delete copy.image_base64;
  delete copy.marked_image_base64;
  delete copy.markedImageBase64;
  return copy;
}

module.exports = { stripInlineImagesIfR2 };
