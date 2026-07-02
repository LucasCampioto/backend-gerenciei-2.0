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

async function getCrmClients(req, res, next) {
  try {
    const userObjectId = new mongoose.Types.ObjectId(req.userId);
    const { clientGroup, category, search } = req.query;

    const query = { userId: userObjectId };

    if (clientGroup && GROUP_ORDER[clientGroup]) {
      query.clientGroup = clientGroup;
    }

    if (category && ['lead', 'cliente'].includes(category)) {
      query.category = category;
    }

    if (search && typeof search === 'string' && search.trim()) {
      const term = search.trim();
      query.$or = [
        { name: { $regex: term, $options: 'i' } },
        { phone: { $regex: term, $options: 'i' } },
      ];
    }

    const [clients, lastSaleMap] = await Promise.all([
      Client.find(query).sort({ name: 1 }).lean(),
      getLastSalesByClient(userObjectId),
    ]);

    const data = clients.map((client) => {
      const formatted = formatCrmClient(client, lastSaleMap);
      if (formatted.lastAppointment) {
        formatted.lastAppointment = new Date(formatted.lastAppointment).toISOString();
      }
      return formatted;
    });

    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

async function getCrmDashboard(req, res, next) {
  try {
    const userObjectId = new mongoose.Types.ObjectId(req.userId);
    const { startDate, endDate } = req.query;

    const activityQuery = { userId: userObjectId };
    if (startDate || endDate) {
      activityQuery.createdAt = parseDateRange(startDate, endDate);
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
    const { clientGroup, noReturnReason, improvementReason, note } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, error: 'ID inválido' });
    }

    const existing = await Client.findOne({ _id: id, userId: req.userId });
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Cliente não encontrado' });
    }

    const updateData = {};

    if (clientGroup !== undefined && clientGroup !== existing.clientGroup) {
      updateData.clientGroup = clientGroup;
      await logActivity({
        userId: req.userId,
        clientId: existing._id,
        clientName: existing.name,
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
        clientName: existing.name,
        type: 'reason_update',
        content: noReturnReason,
      });
    }

    if (improvementReason !== undefined && improvementReason !== existing.improvementReason) {
      updateData.improvementReason = improvementReason;
      await logActivity({
        userId: req.userId,
        clientId: existing._id,
        clientName: existing.name,
        type: 'reason_update',
        content: improvementReason ? `Motivo da melhora: ${improvementReason}` : 'Motivo da melhora removido',
      });
    }

    if (note && !updateData.clientGroup) {
      await logActivity({
        userId: req.userId,
        clientId: existing._id,
        clientName: existing.name,
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

module.exports = {
  getCrmClients,
  getCrmDashboard,
  getClientHistory,
  updateCrmClient,
  addCrmAction,
  deleteCrmActivity,
};
