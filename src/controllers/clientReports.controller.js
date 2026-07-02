const mongoose = require('mongoose');
const Sale = require('../models/Sale');
const Client = require('../models/Client');

const TZ = 'America/Sao_Paulo';

const MONTH_LABELS = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

function parseDateRange(startDate, endDate) {
  const range = {};

  if (startDate) {
    range.$gte = new Date(startDate);
  }

  if (endDate) {
    const parsedEnd = new Date(endDate);
    if (typeof endDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(endDate.trim())) {
      parsedEnd.setUTCHours(23, 59, 59, 999);
    }
    range.$lte = parsedEnd;
  }

  return range;
}

function daysBetween(a, b) {
  const ms = Math.abs(new Date(b).getTime() - new Date(a).getTime());
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

function monthYearKey(date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(new Date(date));
  const year = parts.find((p) => p.type === 'year')?.value;
  const month = parts.find((p) => p.type === 'month')?.value;
  return `${year}-${month}`;
}

function monthLabelFromKey(key) {
  const [year, month] = key.split('-');
  const monthIndex = parseInt(month, 10) - 1;
  return `${MONTH_LABELS[monthIndex] ?? month}/${year}`;
}

async function getProceduresByClient(req, res, next) {
  try {
    const userObjectId = new mongoose.Types.ObjectId(req.userId);
    const { startDate, endDate } = req.query;

    if (!startDate || !endDate) {
      return res.status(400).json({
        success: false,
        error: 'startDate e endDate são obrigatórios',
      });
    }

    const createdAt = parseDateRange(startDate, endDate);

    const rows = await Sale.aggregate([
      {
        $match: {
          userId: userObjectId,
          createdAt,
          clientId: { $exists: true, $ne: null },
        },
      },
      {
        $addFields: {
          items: {
            $map: {
              input: '$items',
              as: 'item',
              in: {
                $mergeObjects: [
                  '$$item',
                  {
                    netValueAllocated: {
                      $cond: [
                        { $gt: ['$totalValue', 0] },
                        {
                          $multiply: [
                            '$netValue',
                            { $divide: ['$$item.totalValue', '$totalValue'] },
                          ],
                        },
                        0,
                      ],
                    },
                  },
                ],
              },
            },
          },
        },
      },
      { $unwind: '$items' },
      {
        $group: {
          _id: {
            clientId: '$clientId',
            clientName: '$clientName',
            procedureId: '$items.procedureId',
            procedureName: '$items.procedureName',
          },
          quantidade: { $sum: '$items.quantity' },
          faturamentoBruto: { $sum: '$items.totalValue' },
          faturamentoLiquido: { $sum: '$items.netValueAllocated' },
          quantidadeVendas: { $sum: 1 },
        },
      },
      { $sort: { '_id.clientName': 1, faturamentoLiquido: -1 } },
    ]);

    const clientsMap = new Map();

    for (const row of rows) {
      const clientId = row._id.clientId.toString();
      const clientName = row._id.clientName || 'Sem nome';

      if (!clientsMap.has(clientId)) {
        clientsMap.set(clientId, {
          clientId,
          clientName,
          procedures: [],
          totais: {
            quantidadeProcedimentos: 0,
            faturamentoBruto: 0,
            faturamentoLiquido: 0,
            quantidadeVendas: 0,
          },
        });
      }

      const client = clientsMap.get(clientId);
      client.procedures.push({
        procedureId: row._id.procedureId?.toString?.() ?? row._id.procedureId,
        procedureName: row._id.procedureName,
        quantidade: row.quantidade,
        faturamentoBruto: round2(row.faturamentoBruto),
        faturamentoLiquido: round2(row.faturamentoLiquido),
        quantidadeVendas: row.quantidadeVendas,
      });

      client.totais.quantidadeProcedimentos += row.quantidade;
      client.totais.faturamentoBruto += row.faturamentoBruto;
      client.totais.faturamentoLiquido += row.faturamentoLiquido;
      client.totais.quantidadeVendas += row.quantidadeVendas;
    }

    const clientIds = [...clientsMap.keys()].map((id) => new mongoose.Types.ObjectId(id));
    const clientDocs = await Client.find({
      _id: { $in: clientIds },
      userId: userObjectId,
    }).lean();

    const clientMeta = new Map(
      clientDocs.map((c) => [
        c._id.toString(),
        { category: c.category, phone: c.phone, isNewClient: c.isNewClient ?? true },
      ])
    );

    const byClient = [...clientsMap.values()]
      .map((client) => {
        const meta = clientMeta.get(client.clientId) ?? {};
        return {
          ...client,
          phone: meta.phone ?? null,
          category: meta.category ?? null,
          isNewClient: meta.isNewClient ?? true,
          totais: {
            quantidadeProcedimentos: client.totais.quantidadeProcedimentos,
            faturamentoBruto: round2(client.totais.faturamentoBruto),
            faturamentoLiquido: round2(client.totais.faturamentoLiquido),
            quantidadeVendas: client.totais.quantidadeVendas,
          },
        };
      })
      .sort((a, b) => b.totais.faturamentoLiquido - a.totais.faturamentoLiquido);

    const totais = byClient.reduce(
      (acc, client) => ({
        clientesComVenda: acc.clientesComVenda + 1,
        quantidadeProcedimentos: acc.quantidadeProcedimentos + client.totais.quantidadeProcedimentos,
        faturamentoLiquido: acc.faturamentoLiquido + client.totais.faturamentoLiquido,
      }),
      { clientesComVenda: 0, quantidadeProcedimentos: 0, faturamentoLiquido: 0 }
    );

    totais.faturamentoLiquido = round2(totais.faturamentoLiquido);

    res.json({
      success: true,
      data: { byClient, totais },
    });
  } catch (error) {
    next(error);
  }
}

async function getClientRecurrence(req, res, next) {
  try {
    const userObjectId = new mongoose.Types.ObjectId(req.userId);
    const { startDate, endDate, inactiveDays = 30 } = req.query;
    const windowDays = Math.max(1, parseInt(inactiveDays, 10) || 30);

    if (!startDate || !endDate) {
      return res.status(400).json({
        success: false,
        error: 'startDate e endDate são obrigatórios',
      });
    }

    const createdAt = parseDateRange(startDate, endDate);
    const now = new Date();

    const salesByClient = await Sale.aggregate([
      {
        $match: {
          userId: userObjectId,
          createdAt,
          clientId: { $exists: true, $ne: null },
        },
      },
      {
        $group: {
          _id: '$clientId',
          clientName: { $first: '$clientName' },
          clientPhone: { $first: '$clientPhone' },
          saleDates: { $push: '$createdAt' },
          quantidadeVendas: { $sum: 1 },
          faturamentoLiquido: { $sum: '$netValue' },
        },
      },
      { $sort: { faturamentoLiquido: -1 } },
    ]);

    const clientIds = salesByClient.map((row) => row._id);
    const clientDocs = await Client.find({
      _id: { $in: clientIds },
      userId: userObjectId,
    }).lean();

    const clientMeta = new Map(
      clientDocs.map((c) => [
        c._id.toString(),
        { category: c.category, phone: c.phone },
      ])
    );

    const detalhes = [];
    let recorrentes = 0;
    let naoRecorrentes = 0;
    let inativos = 0;

    for (const row of salesByClient) {
      const clientId = row._id.toString();
      const meta = clientMeta.get(clientId) ?? {};
      const saleDates = row.saleDates
        .map((d) => new Date(d))
        .sort((a, b) => a.getTime() - b.getTime());

      const primeiraVenda = saleDates[0];
      const ultimaVenda = saleDates[saleDates.length - 1];
      const diasDesdeUltimaVenda = daysBetween(ultimaVenda, now);

      let menorIntervaloRetorno = null;
      let retornouEm30Dias = false;

      for (let i = 1; i < saleDates.length; i += 1) {
        const gap = daysBetween(saleDates[i - 1], saleDates[i]);
        if (menorIntervaloRetorno === null || gap < menorIntervaloRetorno) {
          menorIntervaloRetorno = gap;
        }
        if (gap <= windowDays) {
          retornouEm30Dias = true;
        }
      }

      let tipo;
      if (row.quantidadeVendas >= 2 && retornouEm30Dias) {
        tipo = 'recorrente';
        recorrentes += 1;
      } else if (diasDesdeUltimaVenda > windowDays) {
        tipo = 'inativo';
        inativos += 1;
      } else {
        tipo = 'nao_recorrente';
        naoRecorrentes += 1;
      }

      detalhes.push({
        clientId,
        clientName: row.clientName || 'Sem nome',
        clientPhone: row.clientPhone || meta.phone || null,
        category: meta.category ?? null,
        quantidadeVendas: row.quantidadeVendas,
        faturamentoLiquido: round2(row.faturamentoLiquido),
        primeiraVenda: primeiraVenda.toISOString(),
        ultimaVenda: ultimaVenda.toISOString(),
        diasDesdeUltimaVenda,
        menorIntervaloRetorno,
        retornouEm30Dias,
        tipo,
      });
    }

    const total = detalhes.length;

    res.json({
      success: true,
      data: {
        resumo: {
          inactiveDays: windowDays,
          totalClientesComVenda: total,
          recorrentes,
          naoRecorrentes,
          inativos,
          taxaRecorrencia: total > 0 ? round2((recorrentes / total) * 100) : 0,
          taxaInatividade: total > 0 ? round2((inativos / total) * 100) : 0,
        },
        detalhes,
      },
    });
  } catch (error) {
    next(error);
  }
}

async function getLeadConversionFunnel(req, res, next) {
  try {
    const userObjectId = new mongoose.Types.ObjectId(req.userId);
    const { startDate, endDate } = req.query;

    if (!startDate || !endDate) {
      return res.status(400).json({
        success: false,
        error: 'startDate e endDate são obrigatórios',
      });
    }

    const createdAt = parseDateRange(startDate, endDate);

    const clients = await Client.find({
      userId: userObjectId,
      createdAt,
    })
      .sort({ createdAt: -1 })
      .lean();

    const clientIds = clients.map((c) => c._id);
    const firstSales = await Sale.aggregate([
      {
        $match: {
          userId: userObjectId,
          clientId: { $in: clientIds },
        },
      },
      {
        $group: {
          _id: '$clientId',
          primeiraVenda: { $min: '$createdAt' },
          quantidadeVendas: { $sum: 1 },
        },
      },
    ]);

    const salesMap = new Map(
      firstSales.map((row) => [
        row._id.toString(),
        {
          primeiraVenda: row.primeiraVenda,
          quantidadeVendas: row.quantidadeVendas,
        },
      ])
    );

    const funnelMap = new Map();
    const leadsAtivos = [];

    for (const client of clients) {
      const id = client._id.toString();
      const key = monthYearKey(client.createdAt);
      const saleInfo = salesMap.get(id);

      if (!funnelMap.has(key)) {
        funnelMap.set(key, {
          monthKey: key,
          monthLabel: monthLabelFromKey(key),
          leadsEntraram: 0,
          virouCliente: 0,
          permaneceuLead: 0,
          comVenda: 0,
        });
      }

      const bucket = funnelMap.get(key);
      bucket.leadsEntraram += 1;

      if (client.category === 'cliente') {
        bucket.virouCliente += 1;
      } else {
        bucket.permaneceuLead += 1;
        leadsAtivos.push({
          id,
          name: client.name,
          phone: client.phone,
          category: client.category,
          isNewClient: client.isNewClient ?? client.isNew ?? true,
          createdAt: client.createdAt,
          convertedAt: client.convertedAt ?? null,
          comVenda: Boolean(saleInfo),
          quantidadeVendas: saleInfo?.quantidadeVendas ?? 0,
          primeiraVenda: saleInfo?.primeiraVenda ?? null,
        });
      }

      if (saleInfo) {
        bucket.comVenda += 1;
      }
    }

    const funnel = [...funnelMap.values()]
      .sort((a, b) => a.monthKey.localeCompare(b.monthKey))
      .map((row) => ({
        ...row,
        taxaConversaoCliente: row.leadsEntraram > 0
          ? round2((row.virouCliente / row.leadsEntraram) * 100)
          : 0,
        taxaConversaoVenda: row.leadsEntraram > 0
          ? round2((row.comVenda / row.leadsEntraram) * 100)
          : 0,
      }));

    const totais = funnel.reduce(
      (acc, row) => ({
        leadsEntraram: acc.leadsEntraram + row.leadsEntraram,
        virouCliente: acc.virouCliente + row.virouCliente,
        permaneceuLead: acc.permaneceuLead + row.permaneceuLead,
        comVenda: acc.comVenda + row.comVenda,
      }),
      { leadsEntraram: 0, virouCliente: 0, permaneceuLead: 0, comVenda: 0 }
    );

    totais.taxaConversaoCliente = totais.leadsEntraram > 0
      ? round2((totais.virouCliente / totais.leadsEntraram) * 100)
      : 0;
    totais.taxaConversaoVenda = totais.leadsEntraram > 0
      ? round2((totais.comVenda / totais.leadsEntraram) * 100)
      : 0;

    res.json({
      success: true,
      data: {
        funnel,
        totais,
        leadsAtivos,
      },
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getProceduresByClient,
  getClientRecurrence,
  getLeadConversionFunnel,
};
