const mongoose = require('mongoose');
const WhatsAppCampaign = require('../models/WhatsAppCampaign');
const Client = require('../models/Client');
const Sale = require('../models/Sale');
const Form = require('../models/Form');
const FormResponse = require('../models/FormResponse');
const Campaign = require('../models/Campaign');
const WhatsAppSettings = require('../models/WhatsAppSettings');
const outbox = require('./whatsappOutbox.service');
const agno = require('./agno.client');
const { stripPhoneDigits } = require('../utils/phoneMatch');

const CLINIC_TZ = 'America/Sao_Paulo';
const MAX_LEADS = WhatsAppCampaign.MAX_LEADS_PER_CAMPAIGN || 30;
const OBJECTIVES = WhatsAppCampaign.OBJECTIVES;

function todayKeySp(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: CLINIC_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function suggestedSlotsForToday(dateKey) {
  // 10:00, 14:30, 18:00 America/Sao_Paulo
  const times = ['10:00', '14:30', '18:00'];
  return times.map((t) => new Date(`${dateKey}T${t}:00-03:00`));
}

function pickSendAt(dateKey, index = 0) {
  const slots = suggestedSlotsForToday(dateKey);
  const slot = slots[index % slots.length];
  if (slot.getTime() > Date.now() + 15 * 60 * 1000) return slot;
  // se já passou, agenda daqui a 30 min
  return new Date(Date.now() + 30 * 60 * 1000);
}

async function buildCampaignFacts(userId) {
  const userObjectId = new mongoose.Types.ObjectId(userId);
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
  const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);

  const [
    salesThisWeek,
    salesPrevWeek,
    newLeads,
    staleLeads,
    clientsNoSale,
    naoFechamentoForms,
  ] = await Promise.all([
    Sale.aggregate([
      { $match: { userId: userObjectId, createdAt: { $gte: weekAgo } } },
      {
        $group: {
          _id: null,
          count: { $sum: 1 },
          net: { $sum: '$netValue' },
        },
      },
    ]),
    Sale.aggregate([
      {
        $match: {
          userId: userObjectId,
          createdAt: { $gte: twoWeeksAgo, $lt: weekAgo },
        },
      },
      {
        $group: {
          _id: null,
          count: { $sum: 1 },
          net: { $sum: '$netValue' },
        },
      },
    ]),
    Client.find({
      userId: userObjectId,
      category: 'lead',
      createdAt: { $gte: weekAgo },
      whatsappOptOut: { $ne: true },
    })
      .select('_id name phone pipelineStage sourceCampaignId sourceFormId createdAt qualification')
      .sort({ createdAt: -1 })
      .limit(80)
      .lean(),
    Client.find({
      userId: userObjectId,
      category: 'lead',
      createdAt: { $lt: weekAgo },
      pipelineStage: { $nin: ['won', 'lost'] },
      whatsappOptOut: { $ne: true },
    })
      .select('_id name phone pipelineStage createdAt qualification')
      .sort({ updatedAt: -1 })
      .limit(40)
      .lean(),
    Client.find({
      userId: userObjectId,
      category: 'cliente',
      whatsappOptOut: { $ne: true },
    })
      .select('_id name phone convertedAt updatedAt')
      .sort({ updatedAt: -1 })
      .limit(200)
      .lean(),
    Form.find({
      userId: userObjectId,
      templateKey: 'nao_fechamento',
    })
      .select('_id title')
      .lean(),
  ]);

  const thisWeek = salesThisWeek[0] || { count: 0, net: 0 };
  const prevWeek = salesPrevWeek[0] || { count: 0, net: 0 };

  const recentSaleClientIds = new Set(
    (
      await Sale.find({
        userId: userObjectId,
        createdAt: { $gte: ninetyDaysAgo },
      })
        .select('clientId')
        .lean()
    ).map((s) => String(s.clientId))
  );

  const reactivationCandidates = clientsNoSale
    .filter((c) => !recentSaleClientIds.has(String(c._id)))
    .slice(0, 40);

  let objectionLeadIds = [];
  if (naoFechamentoForms.length) {
    const formIds = naoFechamentoForms.map((f) => f._id);
    const responses = await FormResponse.find({
      userId: userObjectId,
      formId: { $in: formIds },
      submittedAt: { $gte: weekAgo },
    })
      .select('clientId')
      .limit(40)
      .lean();
    objectionLeadIds = [...new Set(responses.map((r) => String(r.clientId)).filter(Boolean))];
  }

  const campaigns = await Campaign.find({ userId: userObjectId })
    .select('_id title leadMagnetType')
    .lean();
  const campaignById = new Map(campaigns.map((c) => [String(c._id), c]));

  const leadsByMagnet = {};
  for (const lead of newLeads) {
    const camp = lead.sourceCampaignId
      ? campaignById.get(String(lead.sourceCampaignId))
      : null;
    const key = camp?.leadMagnetType || (lead.sourceFormId ? 'form' : 'other');
    if (!leadsByMagnet[key]) leadsByMagnet[key] = 0;
    leadsByMagnet[key] += 1;
  }

  const compact = (list) =>
    list.slice(0, 25).map((c) => ({
      id: String(c._id),
      name: c.name,
      phone: stripPhoneDigits(c.phone || '').slice(-4),
      stage: c.pipelineStage || '',
      magnet: c.sourceCampaignId
        ? campaignById.get(String(c.sourceCampaignId))?.leadMagnetType || ''
        : '',
    }));

  return {
    dateKey: todayKeySp(),
    sales: {
      thisWeekCount: thisWeek.count || 0,
      thisWeekNet: Math.round(thisWeek.net || 0),
      prevWeekCount: prevWeek.count || 0,
      prevWeekNet: Math.round(prevWeek.net || 0),
      weekWeaker: (thisWeek.net || 0) < (prevWeek.net || 0) * 0.85,
    },
    newLeadsCount: newLeads.length,
    leadsByMagnet,
    staleLeadsCount: staleLeads.length,
    reactivationCount: reactivationCandidates.length,
    objectionLeadsCount: objectionLeadIds.length,
    pools: {
      newLeads: compact(newLeads),
      staleLeads: compact(staleLeads),
      reactivation: compact(reactivationCandidates),
      objection: objectionLeadIds.slice(0, 25).map((id) => ({ id })),
    },
  };
}

function ruleFallbackCampaigns(facts) {
  const dateKey = facts.dateKey;
  const campaigns = [];

  if (facts.sales.weekWeaker || facts.sales.thisWeekCount < 3) {
    const ids = facts.pools.staleLeads.map((p) => p.id).slice(0, MAX_LEADS);
    if (ids.length) {
      campaigns.push({
        objective: 'increase_sales',
        title: 'Hoje fechar — leads parados',
        reason:
          'A semana está mais fraca em vendas. Vamos aquecer leads que ainda não avançaram no funil.',
        audienceSummary: `${ids.length} leads sem avanço recente`,
        audienceRule: { pool: 'staleLeads' },
        clientIds: ids,
        messageVariants: [
          {
            id: 'v1',
            label: 'Direta',
            body: 'Oi {{nome}}! Vi que você ainda não deu o próximo passo conosco. Quer que eu te ajude a encaixar uma avaliação esta semana?',
          },
          {
            id: 'v2',
            label: 'Consultiva',
            body: 'Oi {{nome}}! Fiquei na dúvida se ainda faz sentido pra você. Posso te explicar as opções sem compromisso?',
          },
          {
            id: 'v3',
            label: 'Urgência leve',
            body: 'Oi {{nome}}! Temos horários bons nesta semana. Quer que eu reserve um pra você?',
          },
        ],
        suggestedSendAt: pickSendAt(dateKey, 0).toISOString(),
      });
    }
  }

  if (facts.newLeadsCount >= 3) {
    const ids = facts.pools.newLeads.map((p) => p.id).slice(0, MAX_LEADS);
    if (ids.length) {
      campaigns.push({
        objective: 'warm_leads',
        title: 'Aquecer leads novos do funil',
        reason: `Entraram ${facts.newLeadsCount} leads nos últimos 7 dias. Hora de descer no funil com uma conversa rápida.`,
        audienceSummary: `${ids.length} leads novos (7 dias)`,
        audienceRule: { pool: 'newLeads' },
        clientIds: ids,
        messageVariants: [
          {
            id: 'v1',
            label: 'Acolhedora',
            body: 'Oi {{nome}}! Que bom te ter por aqui. Quer que eu te ajude a entender o melhor próximo passo?',
          },
          {
            id: 'v2',
            label: 'Resultado',
            body: 'Oi {{nome}}! Vi que você veio de uma das nossas campanhas. Posso te explicar como costuma ser o processo na prática?',
          },
        ],
        suggestedSendAt: pickSendAt(dateKey, 1).toISOString(),
      });
    }
  }

  if (facts.reactivationCount >= 3 && campaigns.length < 3) {
    const ids = facts.pools.reactivation.map((p) => p.id).slice(0, MAX_LEADS);
    campaigns.push({
      objective: 'reactivate',
      title: 'Reativação de clientes',
      reason: 'Há clientes sem compra recente. Uma mensagem carinhosa pode trazer retorno.',
      audienceSummary: `${ids.length} clientes sem compra nos últimos 90 dias`,
      audienceRule: { pool: 'reactivation' },
      clientIds: ids,
      messageVariants: [
        {
          id: 'v1',
          label: 'Carinho',
          body: 'Oi {{nome}}! Senti sua falta por aqui. Quer que eu te mostre o que estamos fazendo de novo e encaixe um horário?',
        },
        {
          id: 'v2',
          label: 'Retorno',
          body: 'Oi {{nome}}! Já está na hora de um retorno? Posso te ajudar a escolher o melhor dia.',
        },
      ],
      suggestedSendAt: pickSendAt(dateKey, 2).toISOString(),
    });
  }

  if (facts.objectionLeadsCount >= 2 && campaigns.length < 3) {
    const ids = facts.pools.objection.map((p) => p.id).slice(0, MAX_LEADS);
    campaigns.push({
      objective: 'discount_objection',
      title: 'Leads com objeção de valor',
      reason: 'Leads responderam formulário de não fechamento — oportunidade de reabrir a conversa com flexibilidade.',
      audienceSummary: `${ids.length} leads de não fechamento (7 dias)`,
      audienceRule: { pool: 'objection' },
      clientIds: ids,
      messageVariants: [
        {
          id: 'v1',
          label: 'Escuta',
          body: 'Oi {{nome}}! Vi que o valor pode ter pesado. Quer que eu te mostre opções e formas de encaixar no seu momento?',
        },
        {
          id: 'v2',
          label: 'Flexível',
          body: 'Oi {{nome}}! Às vezes dá pra ajustar o plano. Posso te explicar alternativas sem pressão?',
        },
      ],
      suggestedSendAt: pickSendAt(dateKey, 1).toISOString(),
    });
  }

  // Garante pelo menos 2 se houver qualquer pool
  while (campaigns.length < 2) {
    const pool =
      facts.pools.staleLeads.length
        ? facts.pools.staleLeads
        : facts.pools.newLeads.length
          ? facts.pools.newLeads
          : facts.pools.reactivation;
    if (!pool.length) break;
    const ids = pool.map((p) => p.id).slice(0, MAX_LEADS);
    campaigns.push({
      objective: 'engage',
      title: 'Engajar base ativa',
      reason: 'Manter relacionamento com quem já demonstrou interesse.',
      audienceSummary: `${ids.length} contatos selecionados`,
      audienceRule: { pool: 'engage' },
      clientIds: ids,
      messageVariants: [
        {
          id: 'v1',
          label: 'Padrão',
          body: 'Oi {{nome}}! Passando pra saber como você está e se posso te ajudar em algo nesta semana.',
        },
        {
          id: 'v2',
          label: 'Convite',
          body: 'Oi {{nome}}! Temos novidades e horários bons. Quer que eu te conte rapidinho?',
        },
      ],
      suggestedSendAt: pickSendAt(dateKey, campaigns.length).toISOString(),
    });
  }

  return campaigns.slice(0, 3);
}

function resolvePoolIds(facts, audienceRule = {}, suggestedIds = []) {
  const poolName = audienceRule.pool;
  let fromPool = [];
  if (poolName && facts.pools[poolName]) {
    fromPool = facts.pools[poolName].map((p) => p.id);
  }
  const suggested = (suggestedIds || []).map(String).filter(Boolean);
  const merged = [...new Set([...suggested, ...fromPool])];
  return merged.slice(0, MAX_LEADS);
}

async function validateClientIds(userId, ids) {
  if (!ids.length) return [];
  const objectIds = ids
    .filter((id) => mongoose.Types.ObjectId.isValid(id))
    .map((id) => new mongoose.Types.ObjectId(id));
  const clients = await Client.find({
    userId,
    _id: { $in: objectIds },
    whatsappOptOut: { $ne: true },
    phone: { $exists: true, $ne: '' },
  })
    .select('_id')
    .lean();
  return clients.map((c) => c._id);
}

async function persistDailyCampaigns(userId, drafts, { source = 'agent', agentRunId = '' } = {}) {
  const dateKey = todayKeySp();

  const prepared = [];
  for (const draft of drafts.slice(0, 3)) {
    const objective = OBJECTIVES.includes(draft.objective)
      ? draft.objective
      : 'engage';
    const clientIds = await validateClientIds(
      userId,
      (draft.clientIds || []).map(String).slice(0, MAX_LEADS)
    );
    if (!clientIds.length) continue;

    const variants = (draft.messageVariants || [])
      .slice(0, 3)
      .map((v, i) => ({
        id: v.id || `v${i + 1}`,
        label: v.label || `Variante ${i + 1}`,
        body: String(v.body || '').trim(),
      }))
      .filter((v) => v.body);

    if (variants.length < 2) continue;

    const suggestedSendAt = draft.suggestedSendAt
      ? new Date(draft.suggestedSendAt)
      : pickSendAt(dateKey, prepared.length);

    prepared.push({
      userId,
      dateKey,
      status: 'pending_approval',
      objective,
      title: String(draft.title || 'Campanha').slice(0, 120),
      reason: String(draft.reason || '').slice(0, 800),
      audienceSummary: String(draft.audienceSummary || '').slice(0, 240),
      audienceRule: draft.audienceRule || {},
      clientIds,
      messageVariants: variants,
      selectedVariantId: variants[0].id,
      suggestedSendAt,
      agentRunId: agentRunId || '',
      source,
    });
  }

  if (!prepared.length) {
    return [];
  }

  // Só apaga pending do dia depois de ter campanhas válidas prontas
  await WhatsAppCampaign.deleteMany({
    userId,
    dateKey,
    status: 'pending_approval',
  });

  const created = [];
  for (const doc of prepared) {
    created.push(await WhatsAppCampaign.create(doc));
  }
  return created;
}

async function countPendingBySource(userId, dateKey = todayKeySp()) {
  const uid = mongoose.Types.ObjectId.isValid(String(userId))
    ? new mongoose.Types.ObjectId(String(userId))
    : userId;
  const rows = await WhatsAppCampaign.aggregate([
    {
      $match: {
        userId: uid,
        dateKey,
        status: 'pending_approval',
      },
    },
    { $group: { _id: '$source', count: { $sum: 1 } } },
  ]);
  const bySource = { agent: 0, rule_fallback: 0 };
  for (const row of rows) {
    if (row._id === 'agent') bySource.agent = row.count;
    else bySource.rule_fallback += row.count;
  }
  return bySource;
}

/**
 * Gera campanhas do dia exclusivamente via Agno (IA).
 * Não grava mais o fallback fixo de regras.
 */
async function generateDailyCampaigns(userId, { force = false } = {}) {
  if (!agno.isAgnoEnabled()) {
    const err = new Error(
      'Agente de campanhas indisponível. Verifique se o Agno está rodando (AGNO_BASE_URL).'
    );
    err.statusCode = 503;
    err.code = 'AGNO_NOT_CONFIGURED';
    throw err;
  }

  const facts = await buildCampaignFacts(userId);
  const dateKey = facts.dateKey;

  if (!force) {
    const bySource = await countPendingBySource(userId, dateKey);
    if (bySource.agent > 0) {
      const existing = await WhatsAppCampaign.find({
        userId,
        dateKey,
        status: 'pending_approval',
        source: 'agent',
      })
        .sort({ createdAt: -1 })
        .limit(3);
      return {
        dateKey,
        count: existing.length,
        source: 'agent',
        items: existing.map(serializeCampaignSummary),
        reused: true,
      };
    }
  }

  let drafts = [];
  let agentRunId = '';

  try {
    const response = await agno.planWhatsAppCampaigns({
      userId: String(userId),
      facts,
      maxCampaigns: 3,
      maxLeads: MAX_LEADS,
      objectives: OBJECTIVES,
    });
    const items = response?.data?.campaigns || response?.data?.items || [];
    if (!Array.isArray(items) || !items.length) {
      const err = new Error('A IA não retornou campanhas. Tente novamente em instantes.');
      err.statusCode = 502;
      err.code = 'AGNO_EMPTY_CAMPAIGNS';
      throw err;
    }
    drafts = items.map((item, idx) => ({
      ...item,
      audienceRule:
        item.audienceRule && typeof item.audienceRule === 'object'
          ? item.audienceRule
          : {},
      clientIds: resolvePoolIds(
        facts,
        item.audienceRule && typeof item.audienceRule === 'object'
          ? item.audienceRule
          : {},
        item.clientIds || []
      ),
      suggestedSendAt:
        item.suggestedSendAt || pickSendAt(facts.dateKey, idx).toISOString(),
    }));
    // Descarta drafts sem audiência resolvida
    drafts = drafts.filter((d) => Array.isArray(d.clientIds) && d.clientIds.length > 0);
    if (!drafts.length) {
      const err = new Error(
        'A IA sugeriu campanhas sem audiência válida. Tente novamente em instantes.'
      );
      err.statusCode = 502;
      err.code = 'AGNO_EMPTY_CAMPAIGNS';
      throw err;
    }
    agentRunId = response.runId || '';
  } catch (error) {
    if (error.code === 'AGNO_EMPTY_CAMPAIGNS') throw error;
    const err = new Error(
      `Falha ao gerar campanhas com IA: ${error.message || 'erro desconhecido'}`
    );
    err.statusCode = 502;
    err.code = 'AGNO_CAMPAIGN_FAILED';
    err.cause = error;
    throw err;
  }

  const created = await persistDailyCampaigns(userId, drafts, {
    source: 'agent',
    agentRunId,
  });

  if (!created.length) {
    const err = new Error(
      'A IA sugeriu campanhas, mas nenhuma ficou válida (audiência/mensagem). Tente de novo.'
    );
    err.statusCode = 502;
    err.code = 'AGNO_CAMPAIGNS_INVALID';
    throw err;
  }

  // Remove pending legado de fallback do mesmo dia (se ainda existir)
  await WhatsAppCampaign.deleteMany({
    userId,
    dateKey,
    status: 'pending_approval',
    source: 'rule_fallback',
  });

  return {
    dateKey,
    count: created.length,
    source: 'agent',
    items: created.map(serializeCampaignSummary),
    reused: false,
  };
}

/**
 * Garante campanhas do dia via IA. Substitui pending de rule_fallback.
 * Em falha da IA, remove fallback antigo para não exibir títulos fixos.
 */
async function ensureAgentDailyCampaigns(userId) {
  const dateKey = todayKeySp();
  const bySource = await countPendingBySource(userId, dateKey);

  if (bySource.agent > 0 && bySource.rule_fallback === 0) {
    return getHomeSummary(userId);
  }

  const force = bySource.rule_fallback > 0;
  try {
    await generateDailyCampaigns(userId, { force });
  } catch (error) {
    console.warn('[waCampaigns] ensure agent failed:', error.message);
    if (bySource.rule_fallback > 0) {
      await WhatsAppCampaign.deleteMany({
        userId,
        dateKey,
        status: 'pending_approval',
        source: 'rule_fallback',
      });
    }
    // Se não havia agent e a geração falhou, não inventa fallback
  }

  return getHomeSummary(userId);
}

function serializeCampaignSummary(doc) {
  const obj = doc.toObject ? doc.toObject() : doc;
  return {
    id: String(obj._id),
    dateKey: obj.dateKey,
    status: obj.status,
    objective: obj.objective,
    title: obj.title,
    reason: obj.reason,
    audienceSummary: obj.audienceSummary,
    leadCount: (obj.clientIds || []).length,
    suggestedSendAt: obj.suggestedSendAt,
    source: obj.source,
    stats: obj.stats,
    selectedVariantId: obj.selectedVariantId,
  };
}

async function listCampaigns(userId, { dateKey, status } = {}) {
  const query = {
    userId,
    // Não listar pending gerado pelo fallback fixo (só IA)
    $nor: [{ status: 'pending_approval', source: 'rule_fallback' }],
  };
  query.dateKey = dateKey || todayKeySp();
  if (status) query.status = status;
  const rows = await WhatsAppCampaign.find(query).sort({ createdAt: -1 }).lean();
  return rows.map(serializeCampaignSummary);
}

async function getCampaignDetail(userId, campaignId) {
  const doc = await WhatsAppCampaign.findOne({ _id: campaignId, userId }).lean();
  if (!doc) {
    const err = new Error('Campanha não encontrada');
    err.statusCode = 404;
    throw err;
  }
  const clients = await Client.find({
    userId,
    _id: { $in: doc.clientIds || [] },
  })
    .select('_id name phone category pipelineStage')
    .lean();

  const dispatches = await outbox.listCampaignDispatches(userId, campaignId);

  return {
    ...serializeCampaignSummary(doc),
    messageVariants: doc.messageVariants,
    audienceRule: doc.audienceRule,
    clients: clients.map((c) => ({
      id: String(c._id),
      name: c.name,
      phone: c.phone,
      category: c.category,
      pipelineStage: c.pipelineStage,
    })),
    dispatches,
    approvedAt: doc.approvedAt,
    rejectedAt: doc.rejectedAt,
  };
}

async function approveCampaign(userId, campaignId, {
  variantId,
  sendAt,
  editedMessages,
} = {}) {
  const settings = await WhatsAppSettings.findOne({ userId }).lean();
  if (!settings || settings.status !== 'connected') {
    const err = new Error('Conecte o WhatsApp antes de aprovar campanhas.');
    err.statusCode = 400;
    err.code = 'WHATSAPP_NOT_CONNECTED';
    throw err;
  }

  const doc = await WhatsAppCampaign.findOne({ _id: campaignId, userId });
  if (!doc) {
    const err = new Error('Campanha não encontrada');
    err.statusCode = 404;
    throw err;
  }
  if (doc.status !== 'pending_approval') {
    const err = new Error('Campanha já foi processada.');
    err.statusCode = 409;
    throw err;
  }

  if (Array.isArray(editedMessages) && editedMessages.length) {
    const byId = new Map(editedMessages.map((m) => [m.id, m.body]));
    doc.messageVariants = doc.messageVariants.map((v) => {
      if (byId.has(v.id) && String(byId.get(v.id) || '').trim()) {
        return { ...v.toObject?.() || v, body: String(byId.get(v.id)).trim() };
      }
      return v;
    });
  }

  const selected =
    doc.messageVariants.find((v) => v.id === (variantId || doc.selectedVariantId)) ||
    doc.messageVariants[0];
  if (!selected?.body) {
    const err = new Error('Selecione uma variante de mensagem válida.');
    err.statusCode = 400;
    throw err;
  }
  doc.selectedVariantId = selected.id;

  if (sendAt) {
    const parsed = new Date(sendAt);
    if (!Number.isNaN(parsed.getTime())) doc.suggestedSendAt = parsed;
  }

  // Revalida audiência no approve
  const validIds = await validateClientIds(
    userId,
    (doc.clientIds || []).map(String).slice(0, MAX_LEADS)
  );
  doc.clientIds = validIds;

  const clients = await Client.find({
    userId,
    _id: { $in: validIds },
  })
    .select('_id name phone')
    .lean();

  const scheduledAt = doc.suggestedSendAt || pickSendAt(doc.dateKey, 0);
  let queued = 0;
  for (const client of clients) {
    const message = String(selected.body)
      .replace(/\{\{\s*nome\s*\}\}/gi, outbox.firstName(client.name));
    const result = await outbox.enqueue({
      userId,
      clientId: client._id,
      phone: client.phone,
      message,
      kind: 'daily_campaign',
      scheduledAt,
      campaignId: doc._id,
      dedupeKey: `campaign:${doc._id}:${client._id}`,
      sourceRef: `whatsappCampaign:${doc._id}`,
      meta: { objective: doc.objective, variantId: selected.id },
    });
    if (result.queued) queued += 1;
  }

  doc.status = queued > 0 ? 'approved' : 'done';
  doc.approvedAt = new Date();
  doc.stats.queued = queued;
  await doc.save();

  return {
    ...serializeCampaignSummary(doc),
    queued,
    scheduledAt,
    selectedVariantId: selected.id,
  };
}

async function rejectCampaign(userId, campaignId) {
  const doc = await WhatsAppCampaign.findOne({ _id: campaignId, userId });
  if (!doc) {
    const err = new Error('Campanha não encontrada');
    err.statusCode = 404;
    throw err;
  }
  if (doc.status !== 'pending_approval') {
    const err = new Error('Campanha já foi processada.');
    err.statusCode = 409;
    throw err;
  }
  doc.status = 'rejected';
  doc.rejectedAt = new Date();
  await doc.save();
  return serializeCampaignSummary(doc);
}

async function getHomeSummary(userId) {
  const dateKey = todayKeySp();
  const pending = await WhatsAppCampaign.find({
    userId,
    dateKey,
    status: 'pending_approval',
    source: 'agent',
  })
    .sort({ createdAt: -1 })
    .limit(3)
    .lean();

  return {
    dateKey,
    pendingCount: pending.length,
    items: pending.map(serializeCampaignSummary),
  };
}

module.exports = {
  todayKeySp,
  buildCampaignFacts,
  ruleFallbackCampaigns,
  generateDailyCampaigns,
  ensureAgentDailyCampaigns,
  listCampaigns,
  getCampaignDetail,
  approveCampaign,
  rejectCampaign,
  getHomeSummary,
  MAX_LEADS,
};
