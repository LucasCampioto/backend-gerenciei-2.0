const PROMPT_VERSION = 'commercial-v1';

const FEATURE_BY_PATH = {
  '/commercial/qualify': 'qualify',
  '/commercial/offer': 'offer',
  '/commercial/objection': 'objection',
  '/commercial/conversation': 'conversation',
  '/commercial/closing-queue': 'closing_queue',
  '/commercial/director': 'director',
  '/commercial/appointment-upsells': 'appointment_upsells',
  '/commercial/prepare-lead': 'prepare_lead',
  '/commercial/reactivation': 'reactivation',
  '/commercial/campaign-themes': 'campaign_themes',
  '/commercial/campaign': 'campaign',
  '/commercial/campaign-quiz': 'campaign_quiz',
  '/commercial/campaign-magnet': 'campaign_magnet',
  '/commercial/topic-correlations': 'topic_correlations',
  '/commercial/diagnosis-personalize': 'diagnosis_personalize',
  '/commercial/content-calendar': 'content_calendar',
  '/commercial/whatsapp-campaigns': 'whatsapp_campaigns',
};

function getAgnoBaseUrl() {
  return (process.env.AGNO_BASE_URL || 'http://localhost:7777').replace(/\/$/, '');
}

function isAgnoEnabled() {
  if (process.env.AGNO_ENABLED === 'false') return false;
  return Boolean(process.env.AGNO_BASE_URL);
}

function featureFromPath(path) {
  if (FEATURE_BY_PATH[path]) return FEATURE_BY_PATH[path];
  return String(path || '')
    .replace(/^\/commercial\//, '')
    .replace(/-/g, '_')
    .slice(0, 64) || 'unknown';
}

function maybeRecordTextUsage(path, body, data, latencyMs) {
  const userId = body?.userId;
  if (!userId || !data) return;
  try {
    const { recordTextUsageAsync } = require('./simulation/aiUsageRecorder');
    recordTextUsageAsync({
      userId,
      feature: featureFromPath(path),
      outcome: data.success === false ? 'failed' : 'success',
      agentData: data,
      latencyMs,
    });
  } catch (err) {
    console.error('[agno] falha ao enfileirar usage', err?.message);
  }
}

async function callAgno(path, body, { timeoutMs = 6000 } = {}) {
  const base = getAgnoBaseUrl();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = Date.now();

  try {
    const response = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Service-Key': process.env.AGNO_SERVICE_KEY || '',
      },
      body: JSON.stringify({
        ...body,
        promptVersion: PROMPT_VERSION,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`Agno ${response.status}: ${text.slice(0, 200)}`);
    }

    const data = await response.json();
    maybeRecordTextUsage(path, body, data, Date.now() - started);
    return data;
  } finally {
    clearTimeout(timer);
  }
}

async function qualifyLead(payload) {
  return callAgno('/commercial/qualify', payload);
}

async function planOffer(payload) {
  return callAgno('/commercial/offer', payload);
}

async function coachObjection(payload) {
  return callAgno('/commercial/objection', payload);
}

async function coachConversation(payload) {
  return callAgno('/commercial/conversation', {
    ...payload,
    mode: payload.mode || payload.context?.conversationMode || 'close',
  }, { timeoutMs: 12000 });
}

async function rankClosingQueue(payload) {
  return callAgno('/commercial/closing-queue', payload);
}

async function commercialDirector(payload) {
  return callAgno('/commercial/director', payload);
}

async function appointmentUpsells(payload) {
  return callAgno('/commercial/appointment-upsells', payload);
}

async function prepareLead(payload) {
  return callAgno('/commercial/prepare-lead', payload);
}

async function generateReactivation(payload) {
  return callAgno('/commercial/reactivation', payload, { timeoutMs: 45000 });
}

async function suggestCampaignThemes(payload) {
  return callAgno('/commercial/campaign-themes', payload, { timeoutMs: 45000 });
}

async function suggestTopicCorrelations(payload) {
  return callAgno('/commercial/topic-correlations', payload, { timeoutMs: 20000 });
}

async function generateCampaign(payload) {
  // Workflow editorial em etapas (arquitetura + escrita em lotes + crítica +
  // marketing) faz várias chamadas ao modelo — budget generoso
  return callAgno('/commercial/campaign', payload, { timeoutMs: 240000 });
}

async function generateQuizCampaign(payload) {
  return callAgno('/commercial/campaign-quiz', payload, { timeoutMs: 180000 });
}

async function generateMagnetCampaign(payload) {
  return callAgno('/commercial/campaign-magnet', payload, { timeoutMs: 120000 });
}

async function personalizeDiagnosisLaudo(payload) {
  // Paciente espera o resultado — budget curto o bastante para UX, longo o bastante p/ LLM
  return callAgno('/commercial/diagnosis-personalize', payload, { timeoutMs: 28000 });
}

async function generateContentCalendar(payload) {
  return callAgno('/commercial/content-calendar', payload, { timeoutMs: 30000 });
}

async function planWhatsAppCampaigns(payload) {
  return callAgno('/commercial/whatsapp-campaigns', payload, { timeoutMs: 45000 });
}

async function healthCheck() {
  const base = getAgnoBaseUrl();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    // Prefer commercial health (promptVersion); fall back to AgentOS /health
    let response = await fetch(`${base}/commercial/health`, { signal: controller.signal });
    if (!response.ok) {
      response = await fetch(`${base}/health`, { signal: controller.signal });
    }
    if (!response.ok) return { ok: false };
    const data = await response.json();
    return { ok: true, ...data };
  } catch {
    return { ok: false };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = {
  PROMPT_VERSION,
  isAgnoEnabled,
  qualifyLead,
  planOffer,
  coachObjection,
  coachConversation,
  rankClosingQueue,
  commercialDirector,
  appointmentUpsells,
  prepareLead,
  generateReactivation,
  suggestCampaignThemes,
  suggestTopicCorrelations,
  generateCampaign,
  generateQuizCampaign,
  generateMagnetCampaign,
  personalizeDiagnosisLaudo,
  generateContentCalendar,
  planWhatsAppCampaigns,
  healthCheck,
};
