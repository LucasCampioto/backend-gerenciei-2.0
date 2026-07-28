const mongoose = require('mongoose');
const Client = require('../models/Client');
const Procedure = require('../models/Procedure');
const Sale = require('../models/Sale');
const agno = require('./agno.client');

function normalize(value = '') {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function eventText(event) {
  return normalize([
    event.title,
    event.summary,
    event.description,
    event.location,
  ].filter(Boolean).join(' '));
}

// Agenda costuma usar o padrão "cliente/procedimento" no título
// (ex.: "Thamires cristina/design"). Extraímos os segmentos separados por "/".
function titleSegments(event) {
  const raw = [event.title, event.summary].filter(Boolean).join(' ');
  return raw
    .split('/')
    .map((part) => normalize(part))
    .filter((part) => part.length >= 3);
}

function matchScore(candidateName, hint) {
  const name = normalize(candidateName);
  if (name.length < 3 || hint.length < 3) return 0;
  if (name === hint) return hint.length + 100;
  if (name.includes(hint) || hint.includes(name)) {
    return Math.min(name.length, hint.length) + 50;
  }
  // Abreviações: "micro" deve casar com "Micropigmentação",
  // "design" com "Design de sobrancelhas" etc.
  const nameWords = name.split(' ');
  const hintWords = hint.split(' ');
  const prefixHit = hintWords.some((hw) =>
    hw.length >= 4 && nameWords.some((nw) => nw.startsWith(hw) || hw.startsWith(nw))
  );
  return prefixHit ? Math.min(name.length, hint.length) : 0;
}

function bestMatch(candidates, getName, hints) {
  let best = null;
  let bestScore = 0;
  for (const candidate of candidates) {
    for (const hint of hints) {
      const score = matchScore(getName(candidate), hint);
      if (score > bestScore) {
        best = candidate;
        bestScore = score;
      }
    }
  }
  return best;
}

function findMentionedProcedure(event, procedures) {
  const text = eventText(event);

  const exact = [...procedures]
    .filter((procedure) => {
      const name = normalize(procedure.name);
      return name.length >= 3 && text.includes(name);
    })
    .sort((a, b) => normalize(b.name).length - normalize(a.name).length)[0];
  if (exact) return exact;

  // Sem match exato: usa os segmentos do título (procedimento vem após a "/").
  const segments = titleSegments(event);
  const hints = segments.length > 1 ? segments.slice(1) : segments;
  return bestMatch(procedures, (p) => p.name, hints);
}

function findMentionedClient(event, clients) {
  const text = eventText(event);
  const rawText = [
    event.title,
    event.summary,
    event.description,
  ].filter(Boolean).join(' ');
  const digits = rawText.replace(/\D/g, '');

  const byPhone = clients.find((client) => {
    const phone = String(client.phone || '').replace(/\D/g, '');
    return phone.length >= 8 && digits.includes(phone);
  });
  if (byPhone) return byPhone;

  const exact = [...clients]
    .filter((client) => {
      const name = normalize(client.name);
      return name.length >= 3 && text.includes(name);
    })
    .sort((a, b) => normalize(b.name).length - normalize(a.name).length)[0];
  if (exact) return exact;

  // Sem match exato: cliente vem antes da "/" no título.
  const segments = titleSegments(event);
  const hints = segments.length > 0 ? [segments[0]] : [];
  return bestMatch(clients, (c) => c.name, hints);
}

function buildPairSignals(sales) {
  const pairs = new Map();
  const popularity = new Map();

  for (const sale of sales) {
    const names = [...new Set(
      (sale.items || [])
        .map((item) => normalize(item.procedureName))
        .filter(Boolean)
    )];

    for (const name of names) {
      popularity.set(name, (popularity.get(name) || 0) + 1);
    }

    for (const source of names) {
      for (const target of names) {
        if (source === target) continue;
        const key = `${source}::${target}`;
        pairs.set(key, (pairs.get(key) || 0) + 1);
      }
    }
  }

  return { pairs, popularity };
}

function getClientPurchaseMap(sales, clientId) {
  const purchases = new Map();
  if (!clientId) return purchases;

  for (const sale of sales) {
    if (sale.clientId?.toString() !== clientId.toString()) continue;
    for (const item of sale.items || []) {
      const name = normalize(item.procedureName);
      const current = purchases.get(name);
      if (!current || new Date(sale.createdAt) > new Date(current)) {
        purchases.set(name, sale.createdAt);
      }
    }
  }
  return purchases;
}

function isForbiddenUpsell(currentName, candidateName) {
  const current = normalize(currentName);
  const candidate = normalize(candidateName);

  // Henna já inclui o design; oferecer outro design não agrega um upsell real.
  if (current.includes('henna') && candidate.includes('design')) return true;

  // Quando a agenda informa apenas "micro", não arriscamos sugerir outra
  // variação de micropigmentação sem saber qual área será atendida.
  if (current.includes('micro') && candidate.includes('micro')) return true;

  return false;
}

function buildCandidates({
  currentProcedure,
  procedures,
  pairSignals,
  clientPurchases,
}) {
  const currentName = normalize(currentProcedure.name);
  const compatible = new Set(
    (currentProcedure.compatibleWith || []).map((value) => normalize(value))
  );
  const now = Date.now();

  return procedures
    .filter((candidate) => candidate._id.toString() !== currentProcedure._id.toString())
    .filter(
      (candidate) => !isForbiddenUpsell(currentProcedure.name, candidate.name)
    )
    .map((candidate) => {
      const candidateName = normalize(candidate.name);
      const pairCount = pairSignals.pairs.get(`${currentName}::${candidateName}`) || 0;
      const popularity = pairSignals.popularity.get(candidateName) || 0;
      const isCompatible = compatible.has(candidateName)
        || compatible.has(candidate._id.toString().toLowerCase());
      const lastPurchaseAt = clientPurchases.get(candidateName) || null;
      const daysSincePurchase = lastPurchaseAt
        ? Math.floor((now - new Date(lastPurchaseAt).getTime()) / (24 * 60 * 60 * 1000))
        : null;
      const recentlyPurchased = daysSincePurchase !== null
        && daysSincePurchase < (candidate.returnAfterDays || 90);

      let score = pairCount * 20 + popularity * 2;
      if (isCompatible) score += 60;
      if (candidate.category && candidate.category !== currentProcedure.category) score += 5;
      if (recentlyPurchased) score -= 100;

      const evidence = [];
      if (pairCount > 0) {
        evidence.push(`vendido junto ${pairCount} vez${pairCount === 1 ? '' : 'es'}`);
      }
      if (isCompatible) evidence.push('marcado como compatível');
      if (lastPurchaseAt && !recentlyPurchased) {
        evidence.push('já faz parte do histórico do cliente e pode estar no período de retorno');
      }
      if (!lastPurchaseAt) evidence.push('ainda não aparece no histórico do cliente');

      return {
        procedureId: candidate._id.toString(),
        procedureName: candidate.name,
        value: candidate.value || 0,
        score,
        pairCount,
        popularity,
        lastPurchaseAt,
        recentlyPurchased,
        hasHistoricalSignal: pairCount > 0 || isCompatible,
        evidence,
      };
    })
    .filter((candidate) => !candidate.recentlyPurchased)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
}

function fallbackRecommendation(appointment) {
  // Prefere evidência histórica, mas ainda sugere o candidato mais bem
  // pontuado quando o evento traz uma abreviação como "micro".
  const candidate = appointment.candidates.find((item) => item.hasHistoricalSignal)
    || appointment.candidates[0];
  if (!candidate) return null;

  return {
    eventId: appointment.eventId,
    clientId: appointment.clientId,
    clientName: appointment.clientName,
    currentProcedure: appointment.currentProcedure,
    upsellProcedure: {
      id: candidate.procedureId,
      name: candidate.procedureName,
      value: candidate.value,
    },
    reason: candidate.hasHistoricalSignal && candidate.evidence.length
      ? `${candidate.procedureName}: ${candidate.evidence.join('; ')}.`
      : `${candidate.procedureName} é uma alternativa complementar ao procedimento de hoje.`,
    evidence: candidate.evidence,
    source: 'rule',
  };
}

async function buildAppointmentUpsells(userId, events, {
  skipCache = false,
  useAi = true,
} = {}) {
  if (!events.length) return [];

  if (!skipCache) {
    const cached = await require('./aiDailyCache.service').getDaily(userId, 'upsells');
    if (cached?.payload?.items) {
      return cached.payload.items;
    }
  }

  const userObjectId = new mongoose.Types.ObjectId(userId);
  const since = new Date();
  since.setFullYear(since.getFullYear() - 2);

  const [procedures, clients, sales] = await Promise.all([
    Procedure.find({ userId: userObjectId }).lean(),
    Client.find({ userId: userObjectId })
      .select('name phone qualification leadScore')
      .lean(),
    Sale.find({
      userId: userObjectId,
      createdAt: { $gte: since },
    })
      .select('clientId items createdAt')
      .sort({ createdAt: -1 })
      .limit(5000)
      .lean(),
  ]);

  const pairSignals = buildPairSignals(sales);
  const appointments = [];

  for (const event of events) {
    const currentProcedure = findMentionedProcedure(event, procedures);
    if (!currentProcedure) continue;

    const client = findMentionedClient(event, clients);
    const clientPurchases = getClientPurchaseMap(sales, client?._id);
    const candidates = buildCandidates({
      currentProcedure,
      procedures,
      pairSignals,
      clientPurchases,
    });
    if (!candidates.length) continue;

    appointments.push({
      eventId: event.id,
      clientId: client?._id?.toString() || null,
      clientName: client?.name || '',
      currentProcedure: {
        id: currentProcedure._id.toString(),
        name: currentProcedure.name,
        value: currentProcedure.value || 0,
      },
      clientHistory: [...clientPurchases.entries()].map(([name, date]) => ({
        procedureName: name,
        lastPurchaseAt: date,
      })),
      qualification: client?.qualification || null,
      candidates,
    });
  }

  const fallback = appointments
    .map(fallbackRecommendation)
    .filter(Boolean);

  if (!appointments.length || !useAi || !agno.isAgnoEnabled()) return fallback;

  try {
    const response = await agno.appointmentUpsells({ userId, appointments });
    const generated = response?.data?.items || [];
    if (!generated.length) return fallback;

    const generatedByEvent = new Map(generated.map((item) => [item.eventId, item]));
    const fallbackByEvent = new Map(fallback.map((item) => [item.eventId, item]));
    return appointments
      .map((appointment) => {
        const aiItem = generatedByEvent.get(appointment.eventId);
        const selectedId = aiItem?.upsellProcedure?.id;
        const allowedCandidate = appointment.candidates.find(
          (candidate) => candidate.procedureId === selectedId
        );
        if (aiItem && allowedCandidate) {
          return {
            ...(fallbackByEvent.get(appointment.eventId) || {}),
            ...aiItem,
            source: 'agent',
            agentRunId: response.runId || '',
          };
        }
        return fallbackByEvent.get(appointment.eventId) || null;
      })
      .filter(Boolean);
  } catch (error) {
    console.warn('[appointmentUpsell] Agno fallback:', error.message);
    return fallback;
  }
}

module.exports = {
  buildAppointmentUpsells,
  findMentionedProcedure,
  findMentionedClient,
  isForbiddenUpsell,
};
