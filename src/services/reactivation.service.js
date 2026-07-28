const Client = require('../models/Client');
const ClientActivity = require('../models/ClientActivity');
const Sale = require('../models/Sale');
const { isAgnoEnabled, generateReactivation } = require('./agno.client');
const { logActivity } = require('./clientActivity.service');

const DAY_MS = 24 * 60 * 60 * 1000;
const STALE_LEAD_DAYS = 30;
const NO_SALES_DAYS = 90;
const MAX_TARGETS = 40;

function daysSince(date) {
  if (!date) return null;
  return Math.max(0, Math.floor((Date.now() - new Date(date).getTime()) / DAY_MS));
}

function firstName(name = '') {
  return String(name).trim().split(/\s+/)[0] || 'oi';
}

async function lastTouchMap(userId, clientIds) {
  if (!clientIds.length) return new Map();
  const rows = await ClientActivity.aggregate([
    { $match: { userId, clientId: { $in: clientIds } } },
    { $group: { _id: '$clientId', lastAt: { $max: '$createdAt' } } },
  ]);
  return new Map(rows.map((r) => [String(r._id), r.lastAt]));
}

async function lastSaleMap(userId, clientIds) {
  if (!clientIds.length) return new Map();
  const sales = await Sale.find({
    userId,
    clientId: { $in: clientIds },
  })
    .sort({ createdAt: -1 })
    .select('clientId createdAt items')
    .lean();

  const map = new Map();
  for (const sale of sales) {
    const id = String(sale.clientId);
    const names = (sale.items || []).map((i) => i.procedureName).filter(Boolean);
    if (!map.has(id)) {
      map.set(id, { at: sale.createdAt, lastProcedure: names[0] || null, procedures: [] });
    }
    const entry = map.get(id);
    for (const n of names) {
      if (entry.procedures.length < 3 && !entry.procedures.includes(n)) {
        entry.procedures.push(n);
      }
    }
  }
  return map;
}

const ACTIVITY_CONTEXT_TYPES = ['form_response', 'objection', 'note', 'contact'];

/** Últimos trechos de atividade relevantes por cliente (para personalizar a mensagem). */
async function recentActivitySnippets(userId, clientIds, { perClient = 3 } = {}) {
  if (!clientIds.length) return new Map();
  const rows = await ClientActivity.find({
    userId,
    clientId: { $in: clientIds },
    type: { $in: ACTIVITY_CONTEXT_TYPES },
    content: { $nin: [null, ''] },
  })
    .sort({ createdAt: -1 })
    .select('clientId type content createdAt')
    .limit(clientIds.length * 10)
    .lean();

  const map = new Map();
  for (const row of rows) {
    const id = String(row.clientId);
    if (!map.has(id)) map.set(id, []);
    const list = map.get(id);
    if (list.length >= perClient) continue;
    list.push({
      type: row.type,
      snippet: String(row.content).slice(0, 220),
      daysAgo: daysSince(row.createdAt),
    });
  }
  return map;
}

function compactQualification(q) {
  if (!q) return null;
  const out = {};
  if (q.pain) out.pain = q.pain;
  if (q.goal) out.goal = q.goal;
  if (q.budgetBand) out.budgetBand = q.budgetBand;
  if (q.urgency) out.urgency = q.urgency;
  if (q.procedureInterest?.length) out.procedureInterest = q.procedureInterest;
  return Object.keys(out).length ? out : null;
}

/**
 * Pool de templates por segmento com interpolação de contexto.
 * A rotação (índice sequencial por segmento) evita duas mensagens
 * iguais em sequência quando a IA está offline.
 */
const HEURISTIC_TEMPLATES = {
  due_return: [
    (c) => `Oi ${c.name}! Já está no período de retorno de ${c.proc}. Quer que eu veja um horário pra você?`,
    (c) => `${c.name}, tudo bem? Chegou a hora de dar uma olhada em como ficou ${c.proc}. Que dia funciona melhor pra você passar aqui?`,
    (c) => `Oi ${c.name}! Estava organizando a agenda e lembrei do seu retorno de ${c.proc}. Posso reservar um horário essa semana?`,
    (c) => `${c.name}, como está o resultado de ${c.proc}? Seria ótimo te ver para o acompanhamento — quer marcar?`,
  ],
  lost: [
    (c) => `Oi ${c.name}! Sei que na época o timing não bateu. Ainda faz sentido conversarmos sobre ${c.proc}?`,
    (c) => `${c.name}, lembrei de você esses dias! ${c.goalLine}Se quiser retomar a conversa, estou por aqui — sem compromisso. Topa?`,
    (c) => `Oi ${c.name}, tudo bem? Muita coisa mudou por aqui desde nossa última conversa. Quer que eu te conte as novidades sobre ${c.proc}?`,
    (c) => `${c.name}, posso te fazer uma pergunta rápida? O que pesou mais na época: o momento ou o investimento? Talvez eu consiga te ajudar agora.`,
  ],
  no_sales: [
    (c) => `Oi ${c.name}! Faz um tempinho que você não passa por aqui. Quer que eu te atualize sobre novidades e horários?`,
    (c) => `${c.name}, saudade de você por aqui! Como está ${c.proc === 'o que conversamos' ? 'tudo' : `o resultado de ${c.proc}`}? Bora agendar uma visita?`,
    (c) => `Oi ${c.name}! Montei umas condições especiais para clientes da casa esse mês. Quer que eu te mande os detalhes?`,
    (c) => `${c.name}, tudo bem? Estava revendo quem faz tempo que não aparece e seu nome veio na hora. Que tal marcarmos algo essa semana?`,
  ],
  stale_lead: [
    (c) => `Oi ${c.name}! Faz uns ${c.days} dias que a gente não se fala. Ainda tem interesse em ${c.proc}? Posso te ajudar com qualquer dúvida.`,
    (c) => `${c.name}, tudo bem? ${c.goalLine}Ficou alguma dúvida que eu possa esclarecer? É rapidinho, prometo.`,
    (c) => `Oi ${c.name}! Você chegou a decidir sobre ${c.proc}? Se ainda estiver pesquisando, posso te mandar um comparativo do que faz mais sentido pro seu caso.`,
    (c) => `${c.name}, lembrei de você hoje! Abriu uma condição boa pra ${c.proc} esse mês. Quer que eu te explique como funciona?`,
    (c) => `Oi ${c.name}, sem pressão nenhuma: só queria saber se ${c.proc} ainda está nos seus planos. Se estiver, me conta o que falta pra gente avançar?`,
  ],
};

const ANGLES = {
  due_return: 'Retorno do procedimento',
  lost: 'Orçamento que esfriou',
  no_sales: 'Cliente sem compra recente',
  stale_lead: 'Lead parado',
};

const PRIORITIES = { due_return: 80, lost: 65, no_sales: 55, stale_lead: 70 };

const templateRotation = new Map();

function heuristicMessage(target) {
  const segment = HEURISTIC_TEMPLATES[target.segment] ? target.segment : 'stale_lead';
  const pool = HEURISTIC_TEMPLATES[segment];
  const rotationKey = segment;
  const idx = templateRotation.get(rotationKey) || 0;
  templateRotation.set(rotationKey, (idx + 1) % pool.length);

  const goal = target.qualification?.goal || '';
  const interest = target.qualification?.procedureInterest?.[0] || null;
  const ctx = {
    name: firstName(target.name),
    days: target.daysSinceTouch || 30,
    proc: interest || target.lastProcedure || 'o que conversamos',
    goalLine: goal ? `Você comentou que queria ${goal.toLowerCase()}. ` : '',
  };

  const reasonBySegment = {
    due_return: `Retorno sugerido — último procedimento: ${ctx.proc}`,
    lost: 'Lead marcado como perdido',
    no_sales: `Sem venda há ${ctx.days} dias`,
    stale_lead: `Sem contato há ${ctx.days} dias`,
  };

  return {
    angle: ANGLES[segment],
    whatsappMessage: pool[idx](ctx),
    reason: reasonBySegment[segment],
    priority: PRIORITIES[segment],
  };
}

/**
 * Coleta alvos de reativação: leads parados, lost, sem venda, retornos.
 */
async function collectReactivationTargets(userId, { limit = MAX_TARGETS } = {}) {
  const clients = await Client.find({ userId }).lean();
  const ids = clients.map((c) => c._id);
  const [touchMap, saleMap] = await Promise.all([
    lastTouchMap(userId, ids),
    lastSaleMap(userId, ids),
  ]);

  const targets = [];

  for (const client of clients) {
    const id = String(client._id);
    const lastActivity = touchMap.get(id);
    const saleInfo = saleMap.get(id);
    const lastTouch =
      lastActivity || saleInfo?.at || client.updatedAt || client.createdAt;
    const days = daysSince(lastTouch) ?? 999;
    const lastProcedure = saleInfo?.lastProcedure || null;
    const journeyNode = (client.journeyPlan?.nodes || []).find(
      (n) => n.id === client.journeyPlan?.currentNodeId
    );

    const base = {
      clientId: id,
      name: client.name || 'Lead',
      phone: client.phone || '',
      daysSinceTouch: days,
      lastProcedure,
      purchasedProcedures: saleInfo?.procedures || [],
      pipelineStage: client.pipelineStage || null,
      category: client.category || null,
      qualification: compactQualification(client.qualification),
      leadTemperature: client.leadTemperature || null,
      leadSource:
        client.leadSource === 'outros'
          ? client.leadSourceOther || 'outros'
          : client.leadSource || null,
      journeyStage: journeyNode?.label || null,
    };

    if (client.pipelineStage === 'lost') {
      targets.push({
        ...base,
        segment: 'lost',
        reason: 'Marcado como perdido',
        priority: 65,
      });
      continue;
    }

    if (client.category === 'lead' && days >= STALE_LEAD_DAYS) {
      targets.push({
        ...base,
        segment: 'stale_lead',
        reason: `Lead sem contato há ${days} dias`,
        priority: Math.min(95, 50 + Math.floor(days / 5)),
      });
      continue;
    }

    if (client.category === 'cliente') {
      const daysSinceSale = saleInfo ? daysSince(saleInfo.at) : 999;
      if (daysSinceSale >= NO_SALES_DAYS) {
        targets.push({
          ...base,
          segment: 'no_sales',
          daysSinceTouch: daysSinceSale,
          reason: saleInfo
            ? `Sem venda há ${daysSinceSale} dias`
            : 'Cliente sem venda registrada',
          priority: 55,
        });
      }
    }
  }

  targets.sort((a, b) => (b.priority || 0) - (a.priority || 0));
  const selected = targets.slice(0, limit);

  // Enriquecer só os selecionados com trechos das últimas atividades
  const snippetMap = await recentActivitySnippets(
    userId,
    selected.map((t) => t.clientId)
  );
  for (const target of selected) {
    target.recentActivities = snippetMap.get(target.clientId) || [];
  }

  return selected;
}

async function generateReactivationCampaign(userId) {
  const targets = await collectReactivationTargets(userId);
  if (!targets.length) {
    return { items: [], targets: [], source: 'empty' };
  }

  let items = [];
  let source = 'heuristic';

  if (isAgnoEnabled()) {
    try {
      const res = await generateReactivation({
        userId: String(userId),
        targets,
      });
      items = res?.data?.items || [];
      // o serviço de agentes informa se caiu no fallback interno dele
      if (items.length) source = res?.source === 'heuristic' ? 'heuristic' : 'agno';
    } catch (err) {
      console.warn('[reactivation] agno failed, using heuristic:', err.message);
    }
  }

  if (!items.length) {
    items = targets.map((t) => {
      const h = heuristicMessage(t);
      return {
        clientId: t.clientId,
        segment: t.segment,
        ...h,
      };
    });
  }

  // Merge display fields from targets
  const byId = new Map(targets.map((t) => [t.clientId, t]));
  const enriched = items.map((item) => {
    const t = byId.get(String(item.clientId)) || {};
    return {
      clientId: String(item.clientId),
      name: t.name || 'Lead',
      phone: t.phone || '',
      segment: item.segment || t.segment || 'stale_lead',
      daysSinceTouch: t.daysSinceTouch,
      lastProcedure: t.lastProcedure,
      angle: item.angle || '',
      whatsappMessage: item.whatsappMessage || '',
      reason: item.reason || t.reason || '',
      priority: item.priority ?? t.priority ?? 50,
      // contexto para os chips da UI (o porquê da mensagem)
      goal: t.qualification?.goal || null,
      pain: t.qualification?.pain || null,
      procedureInterest: t.qualification?.procedureInterest || [],
      leadTemperature: t.leadTemperature || null,
      leadSource: t.leadSource || null,
      journeyStage: t.journeyStage || null,
    };
  });

  return { items: enriched, targets, source };
}

async function markReactivationContacted(userId, clientId, note) {
  const client = await Client.findOne({ _id: clientId, userId });
  if (!client) {
    const err = new Error('Cliente não encontrado');
    err.statusCode = 404;
    throw err;
  }
  await logActivity({
    userId,
    clientId,
    clientName: client.name,
    type: 'contact',
    content: note || 'Mensagem de reativação enviada',
  });
  return { clientId: String(client._id), contacted: true };
}

module.exports = {
  collectReactivationTargets,
  generateReactivationCampaign,
  markReactivationContacted,
  STALE_LEAD_DAYS,
  NO_SALES_DAYS,
};
