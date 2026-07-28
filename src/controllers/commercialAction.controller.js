const CommercialAction = require('../models/CommercialAction');
const {
  buildClosingQueue,
  updateCommercialAction,
  formatCommercialAction,
} = require('../services/commercialIntelligence.service');

async function listCommercialActions(req, res, next) {
  try {
    const refresh = req.query.refresh === '1' || req.query.refresh === 'true';
    const aiDailyCache = require('../services/aiDailyCache.service');
    const closingRankCache = await aiDailyCache.getDaily(req.userId, 'closing_rank');
    const data = await buildClosingQueue(req.userId, {
      refresh: refresh || !closingRankCache?.payload,
      runAiRank: false,
    });
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

async function patchCommercialAction(req, res, next) {
  try {
    const data = await updateCommercialAction(req.userId, req.params.id, req.body);
    res.json({ success: true, data });
  } catch (error) {
    if (error.statusCode === 404) {
      return res.status(404).json({ success: false, error: error.message });
    }
    next(error);
  }
}

async function completeCommercialAction(req, res, next) {
  try {
    const data = await updateCommercialAction(req.userId, req.params.id, {
      status: 'done',
      outcome: req.body.outcome || 'contacted',
      realizedRevenue: req.body.realizedRevenue,
      feedback: req.body.feedback || 'accepted',
    });
    res.json({ success: true, data });
  } catch (error) {
    if (error.statusCode === 404) {
      return res.status(404).json({ success: false, error: error.message });
    }
    next(error);
  }
}

async function snoozeCommercialAction(req, res, next) {
  try {
    const data = await updateCommercialAction(req.userId, req.params.id, {
      status: 'snoozed',
      snoozedUntil: req.body.snoozedUntil,
      feedback: req.body.feedback,
    });
    res.json({ success: true, data });
  } catch (error) {
    if (error.statusCode === 404) {
      return res.status(404).json({ success: false, error: error.message });
    }
    next(error);
  }
}

async function dismissCommercialAction(req, res, next) {
  try {
    const data = await updateCommercialAction(req.userId, req.params.id, {
      status: 'dismissed',
      feedback: req.body.feedback || 'rejected',
      outcome: req.body.outcome || null,
    });
    res.json({ success: true, data });
  } catch (error) {
    if (error.statusCode === 404) {
      return res.status(404).json({ success: false, error: error.message });
    }
    next(error);
  }
}

async function feedbackCommercialAction(req, res, next) {
  try {
    const data = await updateCommercialAction(req.userId, req.params.id, {
      feedback: req.body.feedback,
      editedPayload: req.body.editedPayload,
      suggestedMessage: req.body.suggestedMessage,
      suggestedAction: req.body.suggestedAction,
    });
    res.json({ success: true, data });
  } catch (error) {
    if (error.statusCode === 404) {
      return res.status(404).json({ success: false, error: error.message });
    }
    next(error);
  }
}

async function getCommercialAction(req, res, next) {
  try {
    const action = await CommercialAction.findOne({
      _id: req.params.id,
      userId: req.userId,
    });
    if (!action) {
      return res.status(404).json({ success: false, error: 'Ação não encontrada' });
    }
    res.json({ success: true, data: formatCommercialAction(action) });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  listCommercialActions,
  patchCommercialAction,
  completeCommercialAction,
  snoozeCommercialAction,
  dismissCommercialAction,
  feedbackCommercialAction,
  getCommercialAction,
};
