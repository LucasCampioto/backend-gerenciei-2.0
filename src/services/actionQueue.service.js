const mongoose = require('mongoose');
const Client = require('../models/Client');
const ClientActivity = require('../models/ClientActivity');
const Sale = require('../models/Sale');
const Procedure = require('../models/Procedure');

const DEFAULT_RETURN_DAYS = 90;
const LEAD_INACTIVE_DAYS = 7;
const FORM_FOLLOWUP_DAYS = 3;

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
  return `/crm?clientId=${clientId}&openHistory=1`;
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

async function getLastSaleByClient(userObjectId) {
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

async function getDueReturns(userId, { withinDays = 14 } = {}) {
  const userObjectId = new mongoose.Types.ObjectId(userId);
  const procedures = await Procedure.find({ userId: userObjectId })
    .select('_id name returnAfterDays')
    .lean();

  const procedureMap = new Map(
    procedures.map((p) => [
      p._id.toString(),
      {
        name: p.name,
        returnAfterDays: p.returnAfterDays && p.returnAfterDays > 0
          ? p.returnAfterDays
          : DEFAULT_RETURN_DAYS,
      },
    ])
  );

  const sales = await Sale.find({
    userId: userObjectId,
    clientId: { $exists: true, $ne: null },
  })
    .select('clientId clientName clientPhone items createdAt')
    .sort({ createdAt: -1 })
    .lean();

  const latestByClientProcedure = new Map();

  for (const sale of sales) {
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
  const [clients, lastActivityMap, lastSaleMap, dueReturns] = await Promise.all([
    Client.find({ userId: userObjectId }).lean(),
    getLastActivityByClient(userObjectId),
    getLastSaleByClient(userObjectId),
    getDueReturns(userId, { withinDays: 14 }),
  ]);

  const items = [];
  const leadCutoff = daysAgo(LEAD_INACTIVE_DAYS);
  const formCutoff = daysAgo(FORM_FOLLOWUP_DAYS);

  for (const client of clients) {
    const clientId = client._id.toString();
    const activity = lastActivityMap.get(clientId);
    const lastSale = lastSaleMap.get(clientId);
    const lastTouch = activity?.lastActivityAt || client.updatedAt || client.createdAt;

    if (client.category === 'lead' && lastTouch && new Date(lastTouch) < leadCutoff) {
      const days = Math.floor((Date.now() - new Date(lastTouch).getTime()) / (24 * 60 * 60 * 1000));
      items.push({
        clientId,
        clientName: client.name,
        phone: client.phone,
        reason: `Lead sem contato há ${days} dias`,
        priority: 90,
        suggestedAction: 'Registrar contato',
        href: hrefForClient(clientId),
        type: 'stale_lead',
      });
    }

    if (client.clientGroup === 'grupo_d') {
      items.push({
        clientId,
        clientName: client.name,
        phone: client.phone,
        reason: 'Cliente no grupo D (inativo)',
        priority: 80,
        suggestedAction: 'Reativar ou registrar motivo',
        href: hrefForClient(clientId),
        type: 'group_d',
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
      });
    }
  }

  for (const ret of dueReturns) {
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
};
