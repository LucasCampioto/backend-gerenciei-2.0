/**
 * Endpoints internos para tools do Agno (service key + X-User-Id).
 */
const CommercialAction = require('../models/CommercialAction');
const Procedure = require('../models/Procedure');
const Sale = require('../models/Sale');
const {
  loadClientContext,
  formatCommercialAction,
} = require('../services/commercialIntelligence.service');
const { logActivity } = require('../services/clientActivity.service');
const mongoose = require('mongoose');

async function getClientContext(req, res, next) {
  try {
    const data = await loadClientContext(req.userId, req.params.clientId);
    if (!data) {
      return res.status(404).json({ success: false, error: 'Cliente não encontrado' });
    }
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

async function listProcedures(req, res, next) {
  try {
    const procedures = await Procedure.find({ userId: req.userId })
      .select('name value category compatibleWith returnAfterDays')
      .lean();
    res.json({
      success: true,
      data: procedures.map((p) => ({
        id: p._id.toString(),
        name: p.name,
        value: p.value,
        category: p.category || '',
        compatibleWith: p.compatibleWith || [],
        returnAfterDays: p.returnAfterDays,
      })),
    });
  } catch (error) {
    next(error);
  }
}

async function listSalesSignals(req, res, next) {
  try {
    const userObjectId = new mongoose.Types.ObjectId(req.userId);
    const rows = await Sale.aggregate([
      { $match: { userId: userObjectId } },
      {
        $group: {
          _id: null,
          avgTicket: { $avg: '$netValue' },
          count: { $sum: 1 },
          totalNet: { $sum: '$netValue' },
        },
      },
    ]);
    const byProcedure = await Sale.aggregate([
      { $match: { userId: userObjectId } },
      { $unwind: '$items' },
      {
        $group: {
          _id: '$items.procedureName',
          count: { $sum: '$items.quantity' },
          revenue: { $sum: '$items.totalValue' },
        },
      },
      { $sort: { count: -1 } },
      { $limit: 15 },
    ]);

    res.json({
      success: true,
      data: {
        avgTicket: rows[0]?.avgTicket || 0,
        salesCount: rows[0]?.count || 0,
        totalNet: rows[0]?.totalNet || 0,
        topProcedures: byProcedure.map((r) => ({
          name: r._id,
          count: r.count,
          revenue: r.revenue,
        })),
      },
    });
  } catch (error) {
    next(error);
  }
}

async function upsertCommercialAction(req, res, next) {
  try {
    const {
      clientId,
      clientName,
      phone,
      type,
      priority,
      expectedValue,
      reason,
      suggestedAction,
      suggestedMessage,
      href,
      agentRunId,
      agentName,
      promptVersion,
      recommendationId,
    } = req.body;

    if (!clientId || !type) {
      return res.status(400).json({
        success: false,
        error: 'clientId e type são obrigatórios',
      });
    }

    let action = await CommercialAction.findOne({
      userId: req.userId,
      clientId,
      type,
      status: { $in: ['pending', 'snoozed'] },
    });

    if (action) {
      Object.assign(action, {
        clientName: clientName ?? action.clientName,
        phone: phone ?? action.phone,
        priority: priority ?? action.priority,
        expectedValue: expectedValue ?? action.expectedValue,
        reason: reason ?? action.reason,
        suggestedAction: suggestedAction ?? action.suggestedAction,
        suggestedMessage: suggestedMessage ?? action.suggestedMessage,
        href: href ?? action.href,
        agentRunId: agentRunId ?? action.agentRunId,
        agentName: agentName ?? action.agentName,
        promptVersion: promptVersion ?? action.promptVersion,
        recommendationId: recommendationId ?? action.recommendationId,
        source: 'agent',
        status: 'pending',
      });
      await action.save();
    } else {
      action = await CommercialAction.create({
        userId: req.userId,
        clientId,
        clientName: clientName || '',
        phone: phone || '',
        type,
        priority: priority || 50,
        expectedValue: expectedValue || 0,
        reason: reason || '',
        suggestedAction: suggestedAction || '',
        suggestedMessage: suggestedMessage || '',
        href: href || `/jornada?clientId=${clientId}`,
        agentRunId: agentRunId || '',
        agentName: agentName || '',
        promptVersion: promptVersion || '',
        recommendationId: recommendationId || '',
        source: 'agent',
        status: 'pending',
      });
    }

    res.json({ success: true, data: formatCommercialAction(action) });
  } catch (error) {
    next(error);
  }
}

async function logInternalActivity(req, res, next) {
  try {
    const { clientId, clientName, type, content } = req.body;
    if (!clientId || !type || !content) {
      return res.status(400).json({
        success: false,
        error: 'clientId, type e content são obrigatórios',
      });
    }
    const activity = await logActivity({
      userId: req.userId,
      clientId,
      clientName: clientName || '',
      type,
      content,
    });
    res.status(201).json({ success: true, data: activity });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getClientContext,
  listProcedures,
  listSalesSignals,
  upsertCommercialAction,
  logInternalActivity,
};
