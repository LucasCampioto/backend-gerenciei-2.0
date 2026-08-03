const WhatsAppSettings = require('../models/WhatsAppSettings');
const Client = require('../models/Client');
const outbox = require('./whatsappOutbox.service');
const { stripPhoneDigits, isValidBrazilianPhone } = require('../utils/phoneMatch');

const FUNNEL_DELAY_MS_MIN = 60_000;
const FUNNEL_DELAY_MS_MAX = 180_000;

const TYPE_LABELS = {
  ebook: 'ebook',
  quiz: 'quiz',
  checklist: 'checklist',
  diagnosis: 'diagnóstico',
  calculator: 'calculadora',
  evaluation: 'avaliação',
  form: 'formulário',
};

function resolveFunnelType(rawType) {
  const t = String(rawType || 'form').toLowerCase().trim();
  if (WhatsAppSettings.FUNNEL_TEMPLATE_KEYS.includes(t)) return t;
  if (t === 'custom' || t === 'nps' || t === 'nao_fechamento' || t === 'pos_procedimento') {
    return 'form';
  }
  return 'form';
}

function renderFunnelTemplate(template, vars = {}) {
  return String(template || '')
    .replace(/\{\{\s*nome\s*\}\}/gi, vars.nome || '')
    .replace(/\{\{\s*campanha\s*\}\}/gi, vars.campanha || '')
    .replace(/\{\{\s*tipo\s*\}\}/gi, vars.tipo || '');
}

function randomDelayMs() {
  return (
    FUNNEL_DELAY_MS_MIN +
    Math.floor(Math.random() * (FUNNEL_DELAY_MS_MAX - FUNNEL_DELAY_MS_MIN))
  );
}

/**
 * Enfileira boas-vindas após captura de funil (campanha ou formulário).
 * Fire-and-forget safe: nunca lança para o caller público.
 */
async function enqueueFunnelWelcome(userId, clientId, {
  funnelType = 'form',
  campaignTitle = '',
  sourceRef = '',
  dedupeKey = '',
} = {}) {
  try {
    const settings = await WhatsAppSettings.findOne({ userId });
    if (!settings?.funnelWelcomeEnabled) {
      return { queued: false, reason: 'disabled' };
    }
    if (settings.status !== 'connected') {
      return { queued: false, reason: 'not_connected' };
    }

    const client = await Client.findOne({ _id: clientId, userId })
      .select('name phone whatsappOptOut')
      .lean();
    if (!client?.phone) return { queued: false, reason: 'no_client' };
    if (client.whatsappOptOut) return { queued: false, reason: 'opt_out' };
    if (
      !isValidBrazilianPhone(client.phone) &&
      stripPhoneDigits(client.phone).length < 10
    ) {
      return { queued: false, reason: 'invalid_phone' };
    }

    const type = resolveFunnelType(funnelType);
    const templates = {
      ...WhatsAppSettings.DEFAULT_FUNNEL_TEMPLATES,
      ...(settings.funnelTemplates?.toObject?.() || settings.funnelTemplates || {}),
    };
    const template = templates[type] || templates.form;
    const message = renderFunnelTemplate(template, {
      nome: outbox.firstName(client.name),
      campanha: campaignTitle || TYPE_LABELS[type] || type,
      tipo: TYPE_LABELS[type] || type,
    });

    if (!message.trim()) return { queued: false, reason: 'empty_message' };

    const scheduledAt = new Date(Date.now() + randomDelayMs());
    return outbox.enqueue({
      userId,
      clientId: client._id,
      phone: client.phone,
      message,
      kind: 'funnel_welcome',
      scheduledAt,
      dedupeKey: dedupeKey || `funnel:${sourceRef || `${userId}:${clientId}:${type}`}`,
      sourceRef: sourceRef || '',
      meta: { funnelType: type, campaignTitle },
    });
  } catch (error) {
    console.warn('[whatsappFunnel] enqueue failed:', error.message);
    return { queued: false, reason: 'error', error: error.message };
  }
}

module.exports = {
  resolveFunnelType,
  renderFunnelTemplate,
  enqueueFunnelWelcome,
  TYPE_LABELS,
};
