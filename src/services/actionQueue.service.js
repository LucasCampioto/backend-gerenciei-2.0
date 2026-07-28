const mongoose = require('mongoose');
const Client = require('../models/Client');
const ClientActivity = require('../models/ClientActivity');
const Sale = require('../models/Sale');
const Procedure = require('../models/Procedure');

const DEFAULT_RETURN_DAYS = 90;
const LEAD_INACTIVE_DAYS = 7;
const FORM_FOLLOWUP_DAYS = 3;
const RECENT_CLIENT_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

function normalize(value = '') {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function daysSince(date) {
  if (!date) return null;
  return Math.max(0, Math.floor((Date.now() - new Date(date).getTime()) / DAY_MS));
}

function microRegion(name = '') {
  const value = normalize(name);
  if (!value.includes('micro')) return null;
  if (/labial|labio|boca/.test(value)) return 'labial';
  if (/sobrancel|brow/.test(value)) return 'sobrancelha';
  return 'generica';
}

function procedureRegion(name = '') {
  const value = normalize(name);
  if (/labial|labio|boca/.test(value)) return 'labial';
  if (/sobrancel|brow|design|henna/.test(value)) return 'sobrancelha';
  return null;
}

function forbiddenSuggestion(lastProcedure, candidateName) {
  const current = normalize(lastProcedure);
  const candidate = normalize(candidateName);
  if (!current || !candidate || current === candidate) return true;

  const currentRegion = microRegion(current);
  if (!currentRegion) return false;

  const candidateRegion = procedureRegion(candidate);

  // Se a região da micro é desconhecida, não indica outra micro. Quando é
  // conhecida, nunca indica qualquer procedimento na mesma região em
  // cicatrização (inclui design/henna depois de micro de sobrancelha).
  if (currentRegion === 'generica') {
    return Boolean(candidateRegion) || normalize(candidate).includes('micro');
  }
  return candidateRegion === currentRegion;
}

function buildProcedureSignals(sales) {
  const pairs = new Map();
  const popularity = new Map();

  for (const sale of sales) {
    const names = [...new Set(
      (sale.items || []).map((item) => item.procedureName).filter(Boolean)
    )];
    for (const name of names) {
      const key = normalize(name);
      popularity.set(key, (popularity.get(key) || 0) + 1);
    }
    for (const source of names) {
      for (const target of names) {
        if (normalize(source) === normalize(target)) continue;
        const key = `${normalize(source)}::${normalize(target)}`;
        pairs.set(key, (pairs.get(key) || 0) + 1);
      }
    }
  }

  return { pairs, popularity };
}

function buildGroundedSuggestion({
  lastSale,
  procedures,
  signals,
}) {
  if (!lastSale) {
    return {
      suggestion: 'Manter o contato aquecido e descobrir o objetivo antes de ofertar.',
      reason: 'Não há procedimento anterior registrado; indicar algo agora seria um palpite sem base.',
    };
  }

  const lastProcedures = (lastSale.lastItems || [])
    .map((item) => item.procedureName)
    .filter(Boolean);
  const lastProcedure = lastProcedures[0] || '';
  const elapsedDays = daysSince(lastSale.lastSaleAt);
  const currentMicroRegion = microRegion(lastProcedure);

  const compatibleIds = new Set();
  for (const procedure of procedures) {
    if (normalize(procedure.name) !== normalize(lastProcedure)) continue;
    for (const compatible of procedure.compatibleWith || []) {
      compatibleIds.add(normalize(compatible));
    }
  }

  // Após micro, só considera candidatos de OUTRA região (nunca a mesma em
  // cicatrização). Pode ofertar sobrancelha depois de labial, limpeza etc.
  const candidates = procedures
    .filter((procedure) => !forbiddenSuggestion(lastProcedure, procedure.name))
    .map((procedure) => {
      const candidateName = normalize(procedure.name);
      const pairCount = signals.pairs.get(
        `${normalize(lastProcedure)}::${candidateName}`
      ) || 0;
      const compatible = compatibleIds.has(candidateName)
        || compatibleIds.has(procedure._id.toString().toLowerCase());
      const popularity = signals.popularity.get(candidateName) || 0;
      return {
        procedure,
        pairCount,
        compatible,
        score: pairCount * 20 + (compatible ? 60 : 0) + popularity,
      };
    })
    .sort((a, b) => b.score - a.score);

  const best = candidates.find((candidate) =>
    candidate.pairCount > 0 || candidate.compatible
  ) || candidates[0];

  if (!best) {
    return {
      suggestion: 'Manter o contato aquecido para uma próxima oportunidade.',
      reason: currentMicroRegion
        ? `A última compra foi ${lastProcedure}${elapsedDays != null ? ` há ${elapsedDays} dia${elapsedDays === 1 ? '' : 's'}` : ''}; a região ainda cicatriza e não há outro procedimento de região diferente no catálogo para indicar com segurança.`
        : `A última compra foi ${lastProcedure}, mas ainda não há combinação histórica ou compatibilidade cadastrada que sustente uma nova oferta.`,
    };
  }

  const evidence = [];
  if (best.pairCount > 0) {
    evidence.push(
      `${lastProcedure} e ${best.procedure.name} foram vendidos juntos ${best.pairCount} vez${best.pairCount === 1 ? '' : 'es'}`
    );
  }
  if (best.compatible) {
    evidence.push('o procedimento está cadastrado como compatível');
  }
  if (!evidence.length) {
    evidence.push(
      `${best.procedure.name} é uma alternativa de outra região/área em relação a ${lastProcedure}`
    );
  }
  if (currentMicroRegion) {
    evidence.push(
      `a região da micropigmentação recente continua em cicatrização, por isso a oferta é em outra área`
    );
  }

  return {
    suggestion: `Sugerir ${best.procedure.name} em uma abordagem consultiva.`,
    reason: `${evidence.join('; ')}.`,
  };
}

function daysAgo(n) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - n);
  return d;
}

function daysFrom(date, n) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + n);
  return d;
}

function hrefForClient(clientId) {
  return `/jornada?clientId=${clientId}`;
}

async function getLastActivityByClient(userObjectId) {
  const rows = await ClientActivity.aggregate([
    { $match: { userId: userObjectId } },
    {
      $group: {
        _id: '$clientId',
        lastActivityAt: { $max: '$createdAt' },
        types: { $push: { type: '$type', createdAt: '$createdAt' } },
      },
    },
  ]);

  return new Map(
    rows.map((row) => [
      row._id.toString(),
      {
        lastActivityAt: row.lastActivityAt,
        types: row.types || [],
      },
    ])
  );
}

async function getLastSaleByClient(userObjectId, sales = null) {
  if (sales) {
    const map = new Map();
    for (const sale of sales) {
      const clientId = sale.clientId?.toString();
      if (!clientId || map.has(clientId)) continue;
      map.set(clientId, {
        lastSaleAt: sale.createdAt,
        lastItems: sale.items || [],
      });
    }
    return map;
  }

  const rows = await Sale.aggregate([
    {
      $match: {
        userId: userObjectId,
        clientId: { $exists: true, $ne: null },
      },
    },
    {
      $sort: { createdAt: -1 },
    },
    {
      $group: {
        _id: '$clientId',
        lastSaleAt: { $first: '$createdAt' },
        lastItems: { $first: '$items' },
      },
    },
  ]);

  return new Map(
    rows.map((row) => [
      row._id.toString(),
      {
        lastSaleAt: row.lastSaleAt,
        lastItems: row.lastItems || [],
      },
    ])
  );
}

async function getDueReturns(
  userId,
  { withinDays = 14, sales = null, procedures = null } = {}
) {
  const userObjectId = new mongoose.Types.ObjectId(userId);
  const procedureRows = procedures || await Procedure.find({ userId: userObjectId })
    .select('_id name returnAfterDays compatibleWith category value')
    .lean();

  const procedureMap = new Map(
    procedureRows.map((p) => [
      p._id.toString(),
      {
        name: p.name,
        returnAfterDays: p.returnAfterDays && p.returnAfterDays > 0
          ? p.returnAfterDays
          : DEFAULT_RETURN_DAYS,
      },
    ])
  );

  const saleRows = sales || await Sale.find({
    userId: userObjectId,
    clientId: { $exists: true, $ne: null },
  })
    .select('clientId clientName clientPhone items createdAt')
    .sort({ createdAt: -1 })
    .lean();

  const latestByClientProcedure = new Map();

  for (const sale of saleRows) {
    const clientId = sale.clientId?.toString();
    if (!clientId) continue;

    for (const item of sale.items || []) {
      const procedureId = item.procedureId?.toString();
      if (!procedureId) continue;
      const key = `${clientId}:${procedureId}`;
      if (latestByClientProcedure.has(key)) continue;

      const meta = procedureMap.get(procedureId) || {
        name: item.procedureName,
        returnAfterDays: DEFAULT_RETURN_DAYS,
      };

      const dueDate = daysFrom(sale.createdAt, meta.returnAfterDays);
      latestByClientProcedure.set(key, {
        clientId,
        clientName: sale.clientName || 'Cliente',
        phone: sale.clientPhone || '',
        procedureId,
        procedureName: meta.name || item.procedureName,
        lastSaleAt: sale.createdAt,
        returnAfterDays: meta.returnAfterDays,
        dueDate,
      });
    }
  }

  const now = new Date();
  const horizon = daysFrom(now, withinDays);

  return Array.from(latestByClientProcedure.values())
    .filter((item) => item.dueDate <= horizon)
    .sort((a, b) => a.dueDate - b.dueDate)
    .map((item) => ({
      ...item,
      overdue: item.dueDate < now,
      dueDate: item.dueDate.toISOString(),
      lastSaleAt: item.lastSaleAt instanceof Date
        ? item.lastSaleAt.toISOString()
        : item.lastSaleAt,
    }));
}

async function buildActionQueue(userId) {
  const userObjectId = new mongoose.Types.ObjectId(userId);

  // Uma única varredura de vendas alimenta last-sale e due-returns.
  const [clients, lastActivityMap, sales, procedures] = await Promise.all([
    Client.find({ userId: userObjectId }).lean(),
    getLastActivityByClient(userObjectId),
    Sale.find({
      userId: userObjectId,
      clientId: { $exists: true, $ne: null },
    })
      .select('clientId clientName clientPhone items createdAt')
      .sort({ createdAt: -1 })
      .lean(),
    Procedure.find({ userId: userObjectId })
      .select('_id name returnAfterDays compatibleWith category value')
      .lean(),
  ]);

  const [lastSaleMap, dueReturns] = await Promise.all([
    getLastSaleByClient(userObjectId, sales),
    getDueReturns(userId, { withinDays: 14, sales, procedures }),
  ]);
  const procedureSignals = buildProcedureSignals(sales);

  const items = [];
  const leadCutoff = daysAgo(LEAD_INACTIVE_DAYS);
  const formCutoff = daysAgo(FORM_FOLLOWUP_DAYS);

  for (const client of clients) {
    const clientId = client._id.toString();
    const activity = lastActivityMap.get(clientId);
    const lastSale = lastSaleMap.get(clientId);
    const touchDates = [
      activity?.lastActivityAt,
      lastSale?.lastSaleAt,
      client.updatedAt,
      client.createdAt,
    ].filter(Boolean).map((value) => new Date(value));
    const lastTouch = touchDates.length
      ? new Date(Math.max(...touchDates.map((date) => date.getTime())))
      : null;
    const lastVisitDays = daysSince(lastSale?.lastSaleAt);
    const lastProcedures = (lastSale?.lastItems || [])
      .map((item) => item.procedureName)
      .filter(Boolean);
    const salesAdvice = buildGroundedSuggestion({
      lastSale,
      procedures,
      signals: procedureSignals,
    });
    const context = {
      lastVisitAt: lastSale?.lastSaleAt || null,
      lastProcedures,
      salesSuggestion: salesAdvice.suggestion,
      salesSuggestionReason: salesAdvice.reason,
    };

    if (client.category === 'lead' && lastTouch && new Date(lastTouch) < leadCutoff) {
      const days = Math.floor((Date.now() - new Date(lastTouch).getTime()) / (24 * 60 * 60 * 1000));
      items.push({
        clientId,
        clientName: client.name,
        phone: client.phone,
        reason: lastSale
          ? `Lead sem contato há ${days} dias`
          : `Lead sem contato há ${days} dias · nunca apareceu (inativo)`,
        priority: 90,
        suggestedAction: 'Registrar contato',
        href: hrefForClient(clientId),
        type: 'stale_lead',
        ...context,
      });
    }

    // Grupo D é um dado manual e pode ficar defasado. Uma venda/visita nos
    // últimos 90 dias prova atividade recente e não deve gerar reativação.
    if (
      client.clientGroup === 'grupo_d'
      && (lastVisitDays === null || lastVisitDays >= RECENT_CLIENT_DAYS)
    ) {
      items.push({
        clientId,
        clientName: client.name,
        phone: client.phone,
        reason: lastSale
          ? `Cliente inativo · última visita há ${lastVisitDays} dias`
          : 'Cliente nunca apareceu (inativo)',
        priority: 80,
        suggestedAction: 'Reativar ou registrar motivo',
        href: hrefForClient(clientId),
        type: 'group_d',
        ...context,
      });
    }

    if (activity?.types?.length) {
      const formResponses = activity.types
        .filter((t) => t.type === 'form_response')
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

      if (formResponses.length > 0) {
        const latestForm = formResponses[0];
        const laterContact = activity.types.some(
          (t) =>
            (t.type === 'contact' || t.type === 'note') &&
            new Date(t.createdAt) > new Date(latestForm.createdAt)
        );

        if (!laterContact && new Date(latestForm.createdAt) >= formCutoff) {
          items.push({
            clientId,
            clientName: client.name,
            phone: client.phone,
            reason: 'Formulário respondido sem follow-up',
            priority: 85,
            suggestedAction: 'Entrar em contato',
            href: hrefForClient(clientId),
            type: 'form_followup',
            ...context,
          });
        }
      }
    }

    if (!lastSale && client.category === 'cliente') {
      items.push({
        clientId,
        clientName: client.name,
        phone: client.phone,
        reason: 'Cliente sem vendas registradas',
        priority: 40,
        suggestedAction: 'Registrar venda',
        href: `/vendas?clientId=${clientId}`,
        type: 'no_sales',
        ...context,
      });
    }
  }

  for (const ret of dueReturns) {
    const salesAdvice = buildGroundedSuggestion({
      lastSale: lastSaleMap.get(ret.clientId),
      procedures,
      signals: procedureSignals,
    });
    items.push({
      clientId: ret.clientId,
      clientName: ret.clientName,
      phone: ret.phone,
      reason: ret.overdue
        ? `Retorno atrasado: ${ret.procedureName}`
        : `Retorno devido: ${ret.procedureName}`,
      priority: ret.overdue ? 95 : 70,
      suggestedAction: 'Agendar retorno / WhatsApp',
      href: hrefForClient(ret.clientId),
      type: 'due_return',
      dueDate: ret.dueDate,
      lastVisitAt: ret.lastSaleAt || null,
      lastProcedures: [ret.procedureName].filter(Boolean),
      salesSuggestion: salesAdvice.suggestion,
      salesSuggestionReason: salesAdvice.reason,
    });
  }

  const deduped = [];
  const seen = new Set();
  for (const item of items.sort((a, b) => b.priority - a.priority)) {
    const key = `${item.clientId}:${item.type}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(item);
  }

  return {
    items: deduped.slice(0, 50),
    dueReturnsCount: dueReturns.length,
    dueReturns: dueReturns.slice(0, 30),
  };
}

module.exports = {
  buildActionQueue,
  getDueReturns,
  DEFAULT_RETURN_DAYS,
  forbiddenSuggestion,
  buildGroundedSuggestion,
};
