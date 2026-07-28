const crypto = require('crypto');
const { randomUUID } = require('crypto');
const Campaign = require('../models/Campaign');
const CampaignLead = require('../models/CampaignLead');
const { isR2Configured, putObject, resolveReadUrl, getObjectBuffer } = require('./simulation/r2Storage');
const { forwardEnhanceToAgent } = require('./simulation/enhanceProxy');
const { extractAfterImageBuffer } = require('./simulation/enhancePayload');
const { createEnhancePairDoc } = require('./simulation/enhancePairs');
const {
  tryDebitSimulationCredit,
  refundSimulationCredit,
} = require('./simulation/simulationQuotas');
const { resolveEnhanceRegioes } = require('./simulation/enhanceDefaultRegions');

const MAX_PHOTO_BYTES = 8 * 1024 * 1024;
const ALLOWED_MIME = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp']);
const UPLOAD_TOKEN_TTL_MS = 60 * 60 * 1000; // 1h

function normalizeDiagnosisVariant(value) {
  return String(value || '').toLowerCase() === 'simulation' ? 'simulation' : 'laudo';
}

function createUploadToken() {
  const token = crypto.randomBytes(24).toString('base64url');
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  const expiresAt = new Date(Date.now() + UPLOAD_TOKEN_TTL_MS);
  return { token, hash, expiresAt };
}

function hashUploadToken(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

function extFromMime(mime, filename) {
  const m = String(mime || '').toLowerCase();
  if (m.includes('png')) return 'png';
  if (m.includes('webp')) return 'webp';
  if (m.includes('jpeg') || m.includes('jpg')) return 'jpg';
  if (filename && typeof filename === 'string') {
    const match = /\.([a-z0-9]+)$/i.exec(filename);
    if (match) return match[1].toLowerCase();
  }
  return 'jpg';
}

function buildWaSalesMessage({ name, profileTitle, topic }) {
  const nome = String(name || 'olá').trim() || 'olá';
  const perfil = String(profileTitle || 'seu perfil').trim();
  const tema = String(topic || 'o procedimento').trim();
  return (
    `Oi ${nome}! Vi seu diagnóstico (${perfil}) sobre ${tema}. ` +
    `Preparei sua simulação de antes/depois com base no que você respondeu. ` +
    `Posso te mandar o resultado e alinhar o próximo passo na clínica?`
  );
}

function resolveProcedureTipo(campaign) {
  const raw = String(campaign.procedureName || campaign.topic || 'Botox').trim();
  const lower = raw.toLowerCase();
  if (lower.includes('botox') || lower.includes('toxina')) return 'Botox';
  if (lower.includes('labial') || lower.includes('lábio') || lower.includes('labio')) {
    return 'Preenchimento Labial';
  }
  return 'Botox';
}

/**
 * Upload público da selfie (somente R2 before — sem Gemini).
 */
async function uploadCampaignLeadPhoto(slug, leadId, { uploadToken, buffer, mime, filename }) {
  if (!buffer?.length) {
    const err = new Error('Envie uma foto (campo image).');
    err.statusCode = 400;
    throw err;
  }
  if (buffer.length > MAX_PHOTO_BYTES) {
    const err = new Error('Foto muito grande (máx. 8 MB).');
    err.statusCode = 400;
    throw err;
  }
  const contentType = String(mime || 'image/jpeg').toLowerCase();
  if (!ALLOWED_MIME.has(contentType) && !contentType.startsWith('image/')) {
    const err = new Error('Formato de imagem inválido. Use JPG, PNG ou WebP.');
    err.statusCode = 400;
    throw err;
  }
  if (!isR2Configured()) {
    const err = new Error('Armazenamento de fotos indisponível no momento.');
    err.statusCode = 503;
    throw err;
  }

  const campaign = await Campaign.findOne({ publicSlug: slug, status: 'published' });
  if (!campaign) {
    const err = new Error('Campanha não encontrada');
    err.statusCode = 404;
    throw err;
  }
  if (normalizeDiagnosisVariant(campaign.diagnosisVariant) !== 'simulation') {
    const err = new Error('Esta campanha não aceita foto de simulação.');
    err.statusCode = 400;
    throw err;
  }

  const lead = await CampaignLead.findOne({ _id: leadId, campaignId: campaign._id });
  if (!lead) {
    const err = new Error('Lead não encontrado');
    err.statusCode = 404;
    throw err;
  }

  const tokenHash = hashUploadToken(uploadToken);
  if (
    !lead.uploadTokenHash ||
    lead.uploadTokenHash !== tokenHash ||
    !lead.uploadTokenExpiresAt ||
    lead.uploadTokenExpiresAt.getTime() < Date.now()
  ) {
    const err = new Error('Token de upload inválido ou expirado.');
    err.statusCode = 403;
    throw err;
  }

  if (lead.simulationStatus === 'ready' || lead.simulationStatus === 'processing') {
    const err = new Error('Simulação já em andamento ou concluída para este lead.');
    err.statusCode = 409;
    throw err;
  }

  const ext = extFromMime(contentType, filename);
  const key = `users/${campaign.userId}/campaign-leads/${campaign._id}/${lead._id}/before.${ext}`;
  await putObject(key, buffer, contentType);

  lead.beforeImageKey = key;
  lead.simulationStatus = 'photo_ready';
  lead.simulationError = null;
  lead.uploadTokenHash = null;
  lead.uploadTokenExpiresAt = null;
  await lead.save();

  return { simulationStatus: 'photo_ready' };
}

/**
 * Gera before/after sob demanda (1 crédito da clínica).
 */
async function generateCampaignLeadSimulation(userId, campaignId, leadId) {
  const campaign = await Campaign.findOne({ _id: campaignId, userId });
  if (!campaign) {
    const err = new Error('Campanha não encontrada');
    err.statusCode = 404;
    throw err;
  }

  const lead = await CampaignLead.findOne({
    _id: leadId,
    campaignId: campaign._id,
    userId,
  });
  if (!lead) {
    const err = new Error('Lead não encontrado');
    err.statusCode = 404;
    throw err;
  }

  if (lead.simulationStatus === 'ready' && lead.afterImageKey) {
    const beforeUrl = lead.beforeImageKey ? await resolveReadUrl(lead.beforeImageKey) : null;
    const afterUrl = await resolveReadUrl(lead.afterImageKey);
    return {
      simulationStatus: 'ready',
      beforeUrl,
      afterUrl,
      waSalesMessage: lead.waSalesMessage || '',
      enhancePairId: lead.enhancePairId || null,
      alreadyGenerated: true,
    };
  }

  if (lead.simulationStatus !== 'photo_ready' && lead.simulationStatus !== 'failed') {
    const err = new Error('Lead ainda não tem foto pronta para simulação.');
    err.statusCode = 400;
    throw err;
  }
  if (!lead.beforeImageKey) {
    const err = new Error('Foto do lead não encontrada.');
    err.statusCode = 400;
    throw err;
  }

  const agentBase = (process.env.ENHANCE_AGENT_BASE_URL || '').trim();
  if (!agentBase) {
    const err = new Error('Serviço de simulação não configurado.');
    err.statusCode = 503;
    throw err;
  }
  if (!isR2Configured()) {
    const err = new Error('Armazenamento indisponível.');
    err.statusCode = 503;
    throw err;
  }

  const debit = await tryDebitSimulationCredit(userId);
  if (!debit.ok) {
    const err = new Error(debit.error || 'Sem créditos de simulação.');
    err.statusCode = debit.status || 403;
    err.code = debit.code;
    throw err;
  }

  lead.simulationStatus = 'processing';
  lead.simulationError = null;
  await lead.save();

  try {
    const { buffer, contentType } = await getObjectBuffer(lead.beforeImageKey);
    const tipo = resolveProcedureTipo(campaign);
    const regioes = resolveEnhanceRegioes('', [tipo]);

    const { data: agentData, status } = await forwardEnhanceToAgent(agentBase, {
      buffer,
      filename: 'before.jpg',
      mime: contentType || 'image/jpeg',
      tipos: [tipo],
      regioes,
      intensidade: 'moderado',
    });

    if (status < 200 || status >= 300) {
      const msg =
        (typeof agentData === 'object' && agentData?.message) ||
        `Falha no agente de simulação (${status})`;
      throw Object.assign(new Error(String(msg)), { statusCode: 502 });
    }

    const extracted = extractAfterImageBuffer(agentData);
    if (!extracted?.buffer?.length) {
      throw Object.assign(new Error('Resposta do agente sem imagem.'), { statusCode: 502 });
    }

    const pairId = randomUUID();
    const afterExt = extFromMime(extracted.mime, null);
    const afterKey = `users/${userId}/campaign-leads/${campaign._id}/${lead._id}/after.${afterExt}`;
    await putObject(afterKey, extracted.buffer, extracted.mime || 'image/jpeg');

    try {
      await createEnhancePairDoc({
        pairId,
        userId,
        originalKey: lead.beforeImageKey,
        afterKey,
        originalContentType: contentType || 'image/jpeg',
        afterContentType: extracted.mime || 'image/jpeg',
      });
    } catch (pairErr) {
      console.warn('[campaign-sim] enhance pair doc failed:', pairErr.message);
    }

    const profiles = campaign.content?.quiz?.resultProfiles || [];
    const profile = lead.quizProfileId
      ? profiles.find((p) => p.id === lead.quizProfileId)
      : null;
    const waSalesMessage = buildWaSalesMessage({
      name: lead.respondentName,
      profileTitle: profile?.title,
      topic: campaign.topic || campaign.procedureName || campaign.title,
    });

    lead.afterImageKey = afterKey;
    lead.enhancePairId = pairId;
    lead.simulationStatus = 'ready';
    lead.waSalesMessage = waSalesMessage;
    lead.simulationError = null;
    await lead.save();

    const beforeUrl = await resolveReadUrl(lead.beforeImageKey);
    const afterUrl = await resolveReadUrl(afterKey);

    return {
      simulationStatus: 'ready',
      beforeUrl,
      afterUrl,
      waSalesMessage,
      enhancePairId: pairId,
      alreadyGenerated: false,
    };
  } catch (err) {
    await refundSimulationCredit(userId).catch(() => {});
    lead.simulationStatus = 'failed';
    lead.simulationError = String(err.message || 'Falha ao gerar simulação').slice(0, 300);
    await lead.save().catch(() => {});
    if (!err.statusCode) err.statusCode = 502;
    throw err;
  }
}

async function resolveLeadImageUrls(lead) {
  let beforeUrl = null;
  let afterUrl = null;
  try {
    if (lead.beforeImageKey) beforeUrl = await resolveReadUrl(lead.beforeImageKey);
  } catch {
    /* ignore */
  }
  try {
    if (lead.afterImageKey) afterUrl = await resolveReadUrl(lead.afterImageKey);
  } catch {
    /* ignore */
  }
  return { beforeUrl, afterUrl };
}

module.exports = {
  normalizeDiagnosisVariant,
  createUploadToken,
  uploadCampaignLeadPhoto,
  generateCampaignLeadSimulation,
  resolveLeadImageUrls,
  buildWaSalesMessage,
  MAX_PHOTO_BYTES,
};
