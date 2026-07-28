const mongoose = require('mongoose');
const Client = require('../models/Client');
const ClientActivity = require('../models/ClientActivity');
const Sale = require('../models/Sale');
const {
  logActivity,
  formatActivity,
  getGroupDirection,
  GROUP_ORDER,
} = require('../services/clientActivity.service');
const { buildActionQueue, getDueReturns } = require('../services/actionQueue.service');
const { formatJourneyPlan, syncClientPipelineWithJourney } = require('../services/journeyPlan.service');
const { syncLeadsWithSales } = require('../services/leadConversion.service');
const Document = require('../models/Document');
const FormResponse = require('../models/FormResponse');
const Form = require('../models/Form');

function parseDateRange(startDate, endDate) {
  const range = {};
  if (startDate) range.$gte = new Date(startDate);
  if (endDate) {
    const parsedEnd = new Date(endDate);
    if (typeof endDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(endDate.trim())) {
      parsedEnd.setUTCHours(23, 59, 59, 999);
    }
    range.$lte = parsedEnd;
  }
  return range;
}

function formatConversationCoach(coach) {
  if (!coach || !coach.approach) return null;
  return {
    mode: coach.mode === 'close' ? 'close' : coach.mode === 'discovery' ? 'discovery' : null,
    approach: coach.approach || '',
    talkingPoints: Array.isArray(coach.talkingPoints) ? coach.talkingPoints : [],
    closeTechnique: coach.closeTechnique || '',
    closeScript: coach.closeScript || '',
    whatsappMessage: coach.whatsappMessage || '',
    techniques: Array.isArray(coach.techniques) ? coach.techniques : [],
    objectionHints: Array.isArray(coach.objectionHints) ? coach.objectionHints : [],
    source: coach.source || '',
    agentRunId: coach.agentRunId || '',
    generatedAt: coach.generatedAt
      ? (coach.generatedAt instanceof Date
        ? coach.generatedAt.toISOString()
        : coach.generatedAt)
      : null,
  };
}

function formatSuggestedOffer(offer) {
  if (!offer || !offer.packageName) return null;
  return {
    packageName: offer.packageName || '',
    procedures: Array.isArray(offer.procedures)
      ? offer.procedures.map((p) => ({
          id: p.id || '',
          name: p.name || '',
          value: Number(p.value) || 0,
        }))
      : [],
    priceAnchor: Number(offer.priceAnchor) || 0,
    installmentSuggestion: offer.installmentSuggestion || '',
    upsell: offer.upsell || '',
    rationale: offer.rationale || '',
    source: offer.source || '',
    agentRunId: offer.agentRunId || '',
    generatedAt: offer.generatedAt
      ? (offer.generatedAt instanceof Date
        ? offer.generatedAt.toISOString()
        : offer.generatedAt)
      : null,
  };
}

function formatCrmClient(client, lastSaleMap) {
  const id = client._id.toString();
  const lastSale = lastSaleMap.get(id);

  return {
    id,
    name: client.name,
    phone: client.phone,
    category: client.category,
    clientGroup: client.clientGroup ?? 'grupo_a',
    noReturnReason: client.noReturnReason ?? '',
    improvementReason: client.improvementReason ?? '',
    leadSource: client.leadSource ?? null,
    leadSourceOther: client.leadSourceOther ?? '',
    pipelineStage: client.pipelineStage ?? 'new',
    leadScore: client.leadScore ?? null,
    leadTemperature: client.leadTemperature ?? null,
    qualification: client.qualification ?? null,
    journeyPlan: formatJourneyPlan(client.journeyPlan),
    conversationCoach: formatConversationCoach(client.conversationCoach),
    suggestedOffer: formatSuggestedOffer(client.suggestedOffer),
    nextFollowUpAt: client.nextFollowUpAt
      ? (client.nextFollowUpAt instanceof Date
        ? client.nextFollowUpAt.toISOString()
        : client.nextFollowUpAt)
      : null,
    lostReason: client.lostReason ?? '',
    assignedTo: client.assignedTo ?? '',
    lastAppointment: lastSale?.lastAppointment ?? null,
    totalSales: lastSale?.totalSales ?? 0,
    createdAt: client.createdAt instanceof Date
      ? client.createdAt.toISOString()
      : client.createdAt,
  };
}

async function getLastSalesByClient(userObjectId) {
  const rows = await Sale.aggregate([
    {
      $match: {
        userId: userObjectId,
        clientId: { $exists: true, $ne: null },
      },
    },
    {
      $group: {
        _id: '$clientId',
        lastAppointment: { $max: '$createdAt' },
        totalSales: { $sum: 1 },
      },
    },
  ]);

  return new Map(
    rows.map((row) => [
      row._id.toString(),
      {
        lastAppointment: row.lastAppointment,
        totalSales: row.totalSales,
      },
    ])
  );
}

const PIPELINE_STAGES = ['new', 'qualified', 'proposal', 'negotiation', 'won', 'lost'];

const PIPELINE_STAGE_LABELS = {
  new: 'Lead entra',
  qualified: 'Qualificado',
  proposal: 'Plano + preço',
  negotiation: 'Conversa',
  won: 'Venda',
  lost: 'Perdido',
};

async function getCrmClients(req, res, next) {
  try {
    const userObjectId = new mongoose.Types.ObjectId(req.userId);
    const {
      clientGroup,
      category,
      search,
      leadSource,
      pipelineStage,
      page = 1,
      limit = 10,
    } = req.query;

    const query = { userId: userObjectId };

    if (clientGroup && GROUP_ORDER[clientGroup]) {
      query.clientGroup = clientGroup;
    }

    if (category && ['lead', 'cliente'].includes(category)) {
      query.category = category;
    }

    if (pipelineStage && PIPELINE_STAGES.includes(pipelineStage)) {
      // Etapas ativas do funil comercial = só category lead
      const activeStages = ['new', 'qualified', 'proposal', 'negotiation'];
      if (activeStages.includes(pipelineStage) && !category) {
        query.category = 'lead';
      }
      if (pipelineStage === 'new') {
        query.$and = [
          ...(query.$and ?? []),
          {
            $or: [
              { pipelineStage: 'new' },
              { pipelineStage: null },
              { pipelineStage: { $exists: false } },
            ],
          },
        ];
      } else {
        query.pipelineStage = pipelineStage;
      }
    }

    if (leadSource === 'sem_origem') {
      query.$and = [
        ...(query.$and ?? []),
        { $or: [{ leadSource: null }, { leadSource: { $exists: false } }] },
      ];
    } else if (leadSource && ['redes_sociais', 'google', 'indicacao', 'outros'].includes(leadSource)) {
      query.leadSource = leadSource;
    }

    if (search && typeof search === 'string' && search.trim()) {
      const term = search.trim();
      query.$and = [
        ...(query.$and ?? []),
        {
          $or: [
            { name: { $regex: term, $options: 'i' } },
            { phone: { $regex: term, $options: 'i' } },
          ],
        },
      ];
    }

    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 10, 1), 100);
    const skip = (pageNum - 1) * limitNum;

    const [total, clients, lastSaleMap] = await Promise.all([
      Client.countDocuments(query),
      Client.find(query).sort({ name: 1 }).skip(skip).limit(limitNum).lean(),
      getLastSalesByClient(userObjectId),
    ]);

    const totalPages = Math.max(1, Math.ceil(total / limitNum));

    const data = clients.map((client) => {
      const formatted = formatCrmClient(client, lastSaleMap);
      if (formatted.lastAppointment) {
        formatted.lastAppointment = new Date(formatted.lastAppointment).toISOString();
      }
      return formatted;
    });

    res.json({
      success: true,
      data,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages,
        hasNextPage: pageNum < totalPages,
        hasPrevPage: pageNum > 1,
      },
    });
  } catch (error) {
    next(error);
  }
}

async function getCrmDashboard(req, res, next) {
  try {
    const userObjectId = new mongoose.Types.ObjectId(req.userId);
    const { startDate, endDate } = req.query;

    const activityQuery = { userId: userObjectId };
    const clientCreatedRange = {};
    if (startDate || endDate) {
      activityQuery.createdAt = parseDateRange(startDate, endDate);
      clientCreatedRange.createdAt = activityQuery.createdAt;
    }

    const [clients, groupChanges, recentActivities] = await Promise.all([
      Client.find({ userId: userObjectId }).lean(),
      ClientActivity.find({
        ...activityQuery,
        type: 'group_change',
        fromGroup: { $exists: true, $nin: [null, ''] },
      })
        .sort({ createdAt: -1 })
        .lean(),
      ClientActivity.find(activityQuery)
        .sort({ createdAt: -1 })
        .limit(100)
        .lean(),
    ]);

    const byGroup = {
      grupo_a: 0,
      grupo_b: 0,
      grupo_c: 0,
      grupo_d: 0,
    };

    clients.forEach((client) => {
      const group = client.clientGroup ?? 'grupo_a';
      if (byGroup[group] !== undefined) byGroup[group] += 1;
    });

    const byLeadSource = {
      redes_sociais: 0,
      google: 0,
      indicacao: 0,
      outros: 0,
      sem_origem: 0,
    };

    const leadQuery = { userId: userObjectId, category: 'lead' };
    if (clientCreatedRange.createdAt) {
      leadQuery.createdAt = clientCreatedRange.createdAt;
    }

    const leadsInPeriod = await Client.find(leadQuery).lean();
    leadsInPeriod.forEach((lead) => {
      if (!lead.leadSource) {
        byLeadSource.sem_origem += 1;
        return;
      }
      if (byLeadSource[lead.leadSource] !== undefined) {
        byLeadSource[lead.leadSource] += 1;
      }
    });

    let upgrades = 0;
    let downgrades = 0;

    groupChanges.forEach((activity) => {
      if (!activity.fromGroup || !activity.toGroup || activity.fromGroup === activity.toGroup) {
        return;
      }

      const direction = getGroupDirection(activity.fromGroup, activity.toGroup);
      if (direction === 'upgrade') upgrades += 1;
      if (direction === 'downgrade') downgrades += 1;
    });

    const transitionList = groupChanges
      .filter(
        (activity) =>
          activity.fromGroup &&
          activity.toGroup &&
          activity.fromGroup !== activity.toGroup
      )
      .map(formatActivity);

    res.json({
      success: true,
      data: {
        resumo: {
          totalClientes: clients.length,
          byGroup,
          byLeadSource,
          totalLeadsPeriodo: leadsInPeriod.length,
          mudancasGrupo: transitionList.length,
          upgrades,
          downgrades,
        },
        transicoes: transitionList,
        atividadesRecentes: recentActivities.map(formatActivity),
      },
    });
  } catch (error) {
    next(error);
  }
}

async function getClientHistory(req, res, next) {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, error: 'ID inválido' });
    }

    const activities = await ClientActivity.find({
      userId: req.userId,
      clientId: id,
    })
      .sort({ createdAt: -1 })
      .limit(100);

    res.json({
      success: true,
      data: activities.map(formatActivity),
    });
  } catch (error) {
    next(error);
  }
}

async function updateCrmClient(req, res, next) {
  try {
    const { id } = req.params;
    const {
      name,
      category,
      clientGroup,
      noReturnReason,
      improvementReason,
      leadSource,
      leadSourceOther,
      note,
      pipelineStage,
      nextFollowUpAt,
      lostReason,
      assignedTo,
    } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, error: 'ID inválido' });
    }

    const existing = await Client.findOne({ _id: id, userId: req.userId });
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Cliente não encontrado' });
    }

    const updateData = {};
    const displayName = typeof name === 'string' && name.trim() ? name.trim() : existing.name;

    const previousStage = existing.pipelineStage ?? 'new';
    if (pipelineStage !== undefined) updateData.pipelineStage = pipelineStage;
    if (nextFollowUpAt !== undefined) {
      updateData.nextFollowUpAt = nextFollowUpAt ? new Date(nextFollowUpAt) : null;
    }
    if (lostReason !== undefined) updateData.lostReason = lostReason;
    if (assignedTo !== undefined) updateData.assignedTo = assignedTo;

    if (typeof name === 'string' && name.trim() && name.trim() !== existing.name) {
      updateData.name = name.trim();
    }

    if (category !== undefined && category !== existing.category) {
      updateData.category = category;
      if (category === 'cliente' && existing.category !== 'cliente') {
        updateData.convertedAt = new Date();
        // Cliente sai do funil comercial ativo (Lead entra / Qualifica / Oferta / Conversa)
        const stageNow =
          pipelineStage !== undefined ? pipelineStage : (existing.pipelineStage ?? 'new');
        if (
          !stageNow ||
          stageNow === 'new' ||
          stageNow === 'qualified' ||
          stageNow === 'proposal' ||
          stageNow === 'negotiation'
        ) {
          updateData.pipelineStage = 'won';
        }
        await logActivity({
          userId: req.userId,
          clientId: existing._id,
          clientName: displayName,
          type: 'note',
          content: 'Convertido de lead para cliente',
        });
      }
      if (category === 'lead') {
        updateData.convertedAt = null;
      }
    }

    if (leadSource !== undefined && leadSource !== existing.leadSource) {
      updateData.leadSource = leadSource;
    }

    if (leadSourceOther !== undefined) {
      const nextOther =
        (leadSource !== undefined ? leadSource : existing.leadSource) === 'outros'
          ? String(leadSourceOther || '').trim()
          : '';
      if (nextOther !== (existing.leadSourceOther || '')) {
        updateData.leadSourceOther = nextOther;
      }
    } else if (leadSource !== undefined && leadSource !== 'outros') {
      updateData.leadSourceOther = '';
    }

    if (clientGroup !== undefined && clientGroup !== existing.clientGroup) {
      updateData.clientGroup = clientGroup;
      await logActivity({
        userId: req.userId,
        clientId: existing._id,
        clientName: displayName,
        type: 'group_change',
        fromGroup: existing.clientGroup,
        toGroup: clientGroup,
        content: note || '',
      });
    }

    if (noReturnReason !== undefined && noReturnReason !== existing.noReturnReason) {
      updateData.noReturnReason = noReturnReason;
      await logActivity({
        userId: req.userId,
        clientId: existing._id,
        clientName: displayName,
        type: 'reason_update',
        content: noReturnReason,
      });
    }

    if (improvementReason !== undefined && improvementReason !== existing.improvementReason) {
      updateData.improvementReason = improvementReason;
      await logActivity({
        userId: req.userId,
        clientId: existing._id,
        clientName: displayName,
        type: 'reason_update',
        content: improvementReason ? `Motivo da melhora: ${improvementReason}` : 'Motivo da melhora removido',
      });
    }

    if (
      pipelineStage !== undefined &&
      pipelineStage !== previousStage
    ) {
      const fromLabel = PIPELINE_STAGE_LABELS[previousStage] || previousStage;
      const toLabel = PIPELINE_STAGE_LABELS[pipelineStage] || pipelineStage;
      const reasonSuffix =
        pipelineStage === 'lost' && lostReason
          ? ` · Motivo: ${String(lostReason).trim()}`
          : '';
      await logActivity({
        userId: req.userId,
        clientId: existing._id,
        clientName: displayName,
        type: 'stage_change',
        content: `${fromLabel} → ${toLabel}${reasonSuffix}`,
      });
    }

    if (note && !updateData.clientGroup) {
      await logActivity({
        userId: req.userId,
        clientId: existing._id,
        clientName: displayName,
        type: 'note',
        content: note,
      });
    }

    let client = existing;
    if (Object.keys(updateData).length > 0) {
      client = await Client.findOneAndUpdate(
        { _id: id, userId: req.userId },
        updateData,
        { new: true, runValidators: true }
      );
    }

    const lastSaleMap = await getLastSalesByClient(new mongoose.Types.ObjectId(req.userId));
    const formatted = formatCrmClient(client, lastSaleMap);
    if (formatted.lastAppointment) {
      formatted.lastAppointment = new Date(formatted.lastAppointment).toISOString();
    }

    res.json({
      success: true,
      data: formatted,
      message: 'Cliente atualizado no CRM',
    });
  } catch (error) {
    next(error);
  }
}

async function addCrmAction(req, res, next) {
  try {
    const { id } = req.params;
    const { type, content } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, error: 'ID inválido' });
    }

    const client = await Client.findOne({ _id: id, userId: req.userId });
    if (!client) {
      return res.status(404).json({ success: false, error: 'Cliente não encontrado' });
    }

    const activity = await logActivity({
      userId: req.userId,
      clientId: client._id,
      clientName: client.name,
      type: type || 'note',
      content: content || '',
    });

    res.status(201).json({
      success: true,
      data: formatActivity(activity),
      message: 'Ação registrada',
    });
  } catch (error) {
    next(error);
  }
}

async function deleteCrmActivity(req, res, next) {
  try {
    const { activityId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(activityId)) {
      return res.status(400).json({ success: false, error: 'ID inválido' });
    }

    const deleted = await ClientActivity.findOneAndDelete({
      _id: activityId,
      userId: req.userId,
    });

    if (!deleted) {
      return res.status(404).json({ success: false, error: 'Registro não encontrado' });
    }

    res.json({
      success: true,
      message: 'Registro excluído',
    });
  } catch (error) {
    next(error);
  }
}

async function getActionQueue(req, res, next) {
  try {
    const queue = await buildActionQueue(req.userId);
    res.json({
      success: true,
      data: {
        items: queue.items,
        count: queue.items.length,
        dueReturnsCount: queue.dueReturnsCount,
      },
    });
  } catch (error) {
    next(error);
  }
}

async function getDueReturnsHandler(req, res, next) {
  try {
    const withinDays = Math.min(Math.max(parseInt(req.query.withinDays, 10) || 14, 1), 180);
    const dueReturns = await getDueReturns(req.userId, { withinDays });
    res.json({
      success: true,
      data: dueReturns,
    });
  } catch (error) {
    next(error);
  }
}

async function getClientJourney(req, res, next) {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, error: 'ID inválido' });
    }

    const userObjectId = new mongoose.Types.ObjectId(req.userId);
    const clientObjectId = new mongoose.Types.ObjectId(id);

    const client = await Client.findOne({ _id: clientObjectId, userId: userObjectId }).lean();
    if (!client) {
      return res.status(404).json({ success: false, error: 'Cliente não encontrado' });
    }

    const [activities, sales, formResponses, documents] = await Promise.all([
      ClientActivity.find({ userId: userObjectId, clientId: clientObjectId })
        .sort({ createdAt: -1 })
        .lean(),
      Sale.find({ userId: userObjectId, clientId: clientObjectId })
        .sort({ createdAt: -1 })
        .lean(),
      FormResponse.find({ userId: userObjectId, clientId: clientObjectId })
        .sort({ submittedAt: -1 })
        .lean(),
      Document.find({ userId: userObjectId, clientId: clientObjectId })
        .sort({ signedAt: -1 })
        .lean(),
    ]);

    const formIds = [...new Set(formResponses.map((r) => r.formId?.toString()).filter(Boolean))];
    const forms = formIds.length
      ? await Form.find({ _id: { $in: formIds } }).select('_id title').lean()
      : [];
    const formTitleMap = new Map(forms.map((f) => [f._id.toString(), f.title]));

    const events = [];

    events.push({
      type: 'client_created',
      title: client.category === 'lead' ? 'Lead cadastrado' : 'Cliente cadastrado',
      detail: client.name,
      date: client.createdAt,
      meta: { category: client.category, clientGroup: client.clientGroup },
    });

    const ACTIVITY_TITLES = {
      group_change: 'Mudança de grupo',
      initial_group: 'Grupo inicial',
      note: 'Observação',
      contact: 'Contato',
      reason_update: 'Motivo atualizado',
      form_response: 'Resposta de formulário',
      objection: 'Objeção',
      recommendation_used: 'Recomendação usada',
      action_outcome: 'Resultado de ação',
      qualification: 'Qualificação',
      simulation: 'Simulação',
      stage_change: 'Mudança de etapa',
    };

    for (const activity of activities) {
      events.push({
        type: activity.type,
        title: ACTIVITY_TITLES[activity.type] || activity.type,
        detail: activity.content || '',
        date: activity.createdAt,
        meta: {
          fromGroup: activity.fromGroup,
          toGroup: activity.toGroup,
          activityId: activity._id.toString(),
        },
      });
    }

    for (const sale of sales) {
      events.push({
        type: 'sale',
        title: 'Venda registrada',
        detail: `${(sale.items || []).map((i) => i.procedureName).join(', ') || 'Procedimento'} · R$ ${Number(sale.netValue || 0).toFixed(2)}`,
        date: sale.createdAt,
        meta: {
          saleId: sale._id.toString(),
          netValue: sale.netValue,
          totalValue: sale.totalValue,
        },
      });
    }

    for (const response of formResponses) {
      events.push({
        type: 'form_response',
        title: 'Formulário respondido',
        detail: formTitleMap.get(response.formId?.toString()) || 'Formulário',
        date: response.submittedAt || response.createdAt,
        meta: {
          formId: response.formId?.toString(),
          responseId: response._id.toString(),
        },
      });
    }

    for (const doc of documents) {
      events.push({
        type: 'document',
        title: 'Documento assinado',
        detail: doc.fileName || 'Documento',
        date: doc.signedAt || doc.createdAt,
        meta: {
          documentId: doc._id.toString(),
          fileName: doc.fileName,
        },
      });
    }

    events.sort((a, b) => new Date(b.date) - new Date(a.date));

    res.json({
      success: true,
      data: {
        client: {
          id: client._id.toString(),
          name: client.name,
          phone: client.phone,
          category: client.category,
          clientGroup: client.clientGroup,
          pipelineStage: client.pipelineStage ?? 'new',
          leadScore: client.leadScore ?? null,
          qualification: client.qualification ?? null,
          nextFollowUpAt: client.nextFollowUpAt ?? null,
        },
        events: events.map((e) => ({
          ...e,
          date: e.date instanceof Date ? e.date.toISOString() : e.date,
        })),
      },
    });
  } catch (error) {
    next(error);
  }
}

async function getPipelineBoard(req, res, next) {
  try {
    const userObjectId = new mongoose.Types.ObjectId(req.userId);
    const wonLostDays = Math.min(Math.max(parseInt(req.query.wonLostDays, 10) || 60, 7), 365);
    const wonLostCutoff = new Date();
    wonLostCutoff.setDate(wonLostCutoff.getDate() - wonLostDays);

    // Lead com venda → cliente; cliente em etapa ativa → won
    await syncLeadsWithSales(req.userId).catch(() => {});
    await Client.updateMany(
      {
        userId: userObjectId,
        category: 'cliente',
        $or: [
          { pipelineStage: { $in: ['new', 'qualified', 'proposal', 'negotiation'] } },
          { pipelineStage: null },
          { pipelineStage: { $exists: false } },
        ],
      },
      { $set: { pipelineStage: 'won' } }
    ).catch(() => {});

    // Funil comercial ativo = só category lead.
    // won/lost inclui quem já virou cliente (ex.: após venda).
    const [activeClients, closedClients, lastSaleMap] = await Promise.all([
      Client.find({
        userId: userObjectId,
        category: 'lead',
        $or: [
          { pipelineStage: { $in: ['new', 'qualified', 'proposal', 'negotiation'] } },
          { pipelineStage: null },
          { pipelineStage: { $exists: false } },
        ],
      })
        .sort({ updatedAt: -1, createdAt: -1 })
        .limit(400)
        .lean(),
      Client.find({
        userId: userObjectId,
        pipelineStage: { $in: ['won', 'lost'] },
        updatedAt: { $gte: wonLostCutoff },
      })
        .sort({ updatedAt: -1 })
        .limit(200)
        .lean(),
      getLastSalesByClient(userObjectId),
    ]);

    const byStage = Object.fromEntries(PIPELINE_STAGES.map((s) => [s, []]));
    const counts = Object.fromEntries(PIPELINE_STAGES.map((s) => [s, 0]));

    // Corrige leads em Descoberta que estavam em negotiation (apareciam em Oferta)
    const stageFixes = [];
    for (const client of activeClients) {
      const before = client.pipelineStage;
      const dirty = syncClientPipelineWithJourney(client);
      if (dirty && client.pipelineStage !== before) {
        stageFixes.push({
          updateOne: {
            filter: { _id: client._id, userId: userObjectId },
            update: {
              $set: {
                pipelineStage: client.pipelineStage,
                journeyPlan: client.journeyPlan,
              },
            },
          },
        });
      }
    }
    if (stageFixes.length) {
      await Client.bulkWrite(stageFixes, { ordered: false }).catch(() => {});
    }

    const pushClient = (client) => {
      const stage = PIPELINE_STAGES.includes(client.pipelineStage)
        ? client.pipelineStage
        : 'new';
      const formatted = formatCrmClient(client, lastSaleMap);
      if (formatted.lastAppointment) {
        formatted.lastAppointment = new Date(formatted.lastAppointment).toISOString();
      }
      byStage[stage].push(formatted);
    };

    for (const client of activeClients) pushClient(client);
    for (const client of closedClients) pushClient(client);

    // Contagens: etapas ativas só lead; won/lost todos (lead convertido vira cliente)
    const countRows = await Client.aggregate([
      {
        $match: {
          userId: userObjectId,
          $or: [
            {
              category: 'lead',
              $or: [
                { pipelineStage: { $in: ['new', 'qualified', 'proposal', 'negotiation'] } },
                { pipelineStage: null },
                { pipelineStage: { $exists: false } },
              ],
            },
            { pipelineStage: { $in: ['won', 'lost'] } },
          ],
        },
      },
      {
        $group: {
          _id: {
            $ifNull: ['$pipelineStage', 'new'],
          },
          count: { $sum: 1 },
        },
      },
    ]);

    for (const row of countRows) {
      const key = PIPELINE_STAGES.includes(row._id) ? row._id : 'new';
      counts[key] += row.count;
    }

    res.json({
      success: true,
      data: {
        stages: byStage,
        counts,
        wonLostDays,
      },
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getCrmClients,
  getCrmDashboard,
  getClientHistory,
  updateCrmClient,
  addCrmAction,
  deleteCrmActivity,
  getActionQueue,
  getDueReturnsHandler,
  getClientJourney,
  getPipelineBoard,
};
