const { Router } = require('express');
const { getAfterBufferForUser, getPairUrlsForUser } = require('../services/simulation/enhancePairs');
const { authenticate } = require('../middleware/auth.middleware');

function extFromContentType(ct) {
  const s = (ct || '').toLowerCase();
  if (s.includes('jpeg') || s === 'image/jpg') return 'jpg';
  if (s.includes('png')) return 'png';
  if (s.includes('webp')) return 'webp';
  return 'png';
}

const router = Router();
router.use(authenticate);

/** Download da imagem "depois" via API (evita CORS do fetch direto no R2). */
router.get('/enhance-pairs/:pairId/after', async (req, res) => {
  const pairId = String(req.params.pairId || '').trim();
  if (!pairId) {
    res.status(400).json({ message: 'pairId inválido' });
    return;
  }
  try {
    const out = await getAfterBufferForUser(pairId, req.userId);
    if (!out) {
      res.status(404).json({ message: 'Par não encontrado' });
      return;
    }
    const ext = extFromContentType(out.contentType);
    res.setHeader('Content-Type', out.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="simulacao.${ext}"`);
    res.send(out.buffer);
  } catch (e) {
    console.error('[R2] GET enhance-pairs/:pairId/after', {
      pairId,
      message: e?.message,
      name: e?.name,
      code: e?.Code ?? e?.code,
    });
    res.status(502).json({ message: 'Falha ao ler a imagem da simulação' });
  }
});

router.get('/enhance-pairs/:pairId', async (req, res) => {
  const pairId = String(req.params.pairId || '').trim();
  if (!pairId) {
    res.status(400).json({ message: 'pairId inválido' });
    return;
  }
  try {
    console.log('[R2] GET enhance-pairs', { pairId, userId: req.userId });
    const urls = await getPairUrlsForUser(pairId, req.userId);
    if (!urls) {
      console.log('[R2] GET enhance-pairs: par não encontrado no Mongo', { pairId });
      res.status(404).json({ message: 'Par não encontrado' });
      return;
    }
    console.log('[R2] GET enhance-pairs: ok', { pairId });
    res.json({
      originalUrl: urls.originalUrl,
      afterUrl: urls.afterUrl,
    });
  } catch (e) {
    console.error('[R2] GET enhance-pairs erro (ex.: R2 ao gerar URL)', {
      pairId,
      message: e?.message,
      name: e?.name,
      code: e?.Code ?? e?.code,
      httpStatusCode: e?.$metadata?.httpStatusCode,
      requestId: e?.$metadata?.requestId,
    });
    res.status(502).json({ message: 'Falha ao gerar URLs das imagens' });
  }
});

module.exports = router;
