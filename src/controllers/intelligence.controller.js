const {
  qualifyClient,
  suggestOffer,
  suggestObjectionScript,
  suggestConversationCoach,
  approveJourneyPlan,
  advanceClientJourney,
  moveClientJourneyToNode,
  buildClosingQueue,
  prepareLeadBundle,
  loadClientContext,
} = require('../services/commercialIntelligence.service');
const { getLearningSignals } = require('../services/commercialLearning.service');
const { healthCheck, isAgnoEnabled } = require('../services/agno.client');
const { buildActionQueue } = require('../services/actionQueue.service');
const Sale = require('../models/Sale');
const mongoose = require('mongoose');

async function qualify(req, res, next) {
  try {
    const data = await qualifyClient(req.userId, req.params.clientId, {
      force: req.body?.force !== false,
    });
    res.json({ success: true, data });
  } catch (error) {
    if (error.statusCode === 404) {
      return res.status(404).json({ success: false, error: error.message });
    }
    next(error);
  }
}

async function offer(req, res, next) {
  try {
    const data = await suggestOffer(req.userId, req.params.clientId, {
      force: Boolean(req.body?.force),
    });
    res.json({ success: true, data });
  } catch (error) {
    if (error.statusCode === 404) {
      return res.status(404).json({ success: false, error: error.message });
    }
    next(error);
  }
}

async function objection(req, res, next) {
  try {
    const data = await suggestObjectionScript(
      req.userId,
      req.params.clientId,
      req.body?.objectionText || ''
    );
    res.json({ success: true, data });
  } catch (error) {
    if (error.statusCode === 404) {
      return res.status(404).json({ success: false, error: error.message });
    }
    next(error);
  }
}

async function conversation(req, res, next) {
  try {
    const data = await suggestConversationCoach(req.userId, req.params.clientId, {
      mode: req.body?.mode,
      force: Boolean(req.body?.force),
    });
    res.json({ success: true, data });
  } catch (error) {
    if (error.statusCode === 404) {
      return res.status(404).json({ success: false, error: error.message });
    }
    next(error);
  }
}

async function approveJourney(req, res, next) {
  try {
    const data = await approveJourneyPlan(req.userId, req.params.clientId);
    res.json({ success: true, data });
  } catch (error) {
    if (error.statusCode === 404 || error.statusCode === 400) {
      return res.status(error.statusCode).json({ success: false, error: error.message });
    }
    next(error);
  }
}

async function advanceJourney(req, res, next) {
  try {
    const data = await advanceClientJourney(req.userId, req.params.clientId);
    res.json({ success: true, data });
  } catch (error) {
    if (error.statusCode === 404 || error.statusCode === 400) {
      return res.status(error.statusCode).json({ success: false, error: error.message });
    }
    next(error);
  }
}

async function moveJourney(req, res, next) {
  try {
    const nodeId = String(req.body?.nodeId || '').trim();
    if (!nodeId) {
      return res.status(400).json({ success: false, error: 'nodeId é obrigatório' });
    }
    const data = await moveClientJourneyToNode(req.userId, req.params.clientId, nodeId);
    res.json({ success: true, data });
  } catch (error) {
    if (error.statusCode === 404 || error.statusCode === 400) {
      return res.status(error.statusCode).json({ success: false, error: error.message });
    }
    next(error);
  }
}

async function closingQueue(req, res, next) {
  try {
    // Default: só lê a fila persistida. refresh=1 sincroniza regras/valores
    // (sem LLM). Ranking Agno roda no máximo 1×/dia via cache.
    const refresh = req.query.refresh === '1' || req.query.refresh === 'true';
    const aiDailyCache = require('../services/aiDailyCache.service');
    const {
      runDailyAiAnalyses,
    } = require('../services/commercialIntelligence.service');

    const closingRankCache = await aiDailyCache.getDaily(req.userId, 'closing_rank');
    const data = await buildClosingQueue(req.userId, {
      refresh: refresh || !closingRankCache?.payload,
      runAiRank: false,
    });
    res.json({ success: true, data });

    if (!closingRankCache?.payload) {
      setImmediate(() => {
        runDailyAiAnalyses(req.userId, {
          directorFacts: {
            queueCount: data.count,
            revenueAtRisk: data.totalExpectedValue,
            topActions: data.items.slice(0, 5),
            anomalies: [],
          },
        }).catch((err) => {
          console.warn('[closing-queue] daily AI skipped:', err.message);
        });
      });
    }
  } catch (error) {
    next(error);
  }
}

async function director(req, res, next) {
  try {
    const aiDailyCache = require('../services/aiDailyCache.service');
    const cached = await aiDailyCache.getDaily(req.userId, 'director');
    if (cached?.payload) {
      return res.json({
        success: true,
        data: { ...cached.payload, fromCache: true },
      });
    }

    const userObjectId = new mongoose.Types.ObjectId(req.userId);
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    const [queue, ruleQueue, todayAgg] = await Promise.all([
      buildClosingQueue(req.userId, { refresh: false }),
      buildActionQueue(req.userId).catch(() => ({ items: [], dueReturnsCount: 0 })),
      Sale.aggregate([
        {
          $match: {
            userId: userObjectId,
            createdAt: { $gte: todayStart, $lte: todayEnd },
          },
        },
        {
          $group: {
            _id: null,
            netValue: { $sum: '$netValue' },
            count: { $sum: 1 },
          },
        },
      ]),
    ]);

    const facts = {
      queueCount: queue.count,
      revenueAtRisk: queue.totalExpectedValue,
      todayNet: todayAgg[0]?.netValue || 0,
      todaySalesCount: todayAgg[0]?.count || 0,
      dueReturnsCount: ruleQueue.dueReturnsCount || 0,
      topActions: queue.items.slice(0, 5),
      anomalies: [],
      health: req.body?.healthFacts || null,
    };

    if ((ruleQueue.dueReturnsCount || 0) > 5) {
      facts.anomalies.push('Muitos retornos de procedimento vencendo nos próximos dias.');
    }
    if (queue.count > 15) {
      facts.anomalies.push('Fila comercial acima do usual — priorize os top 5 por valor esperado.');
    }

    // Responde rule-based e agenda o job diário (não espera LLM).
    const data = {
      narrative: `Fila com ${facts.queueCount} ações. Receita potencial ~ R$ ${Math.round(facts.revenueAtRisk || 0).toLocaleString('pt-BR')}.`,
      anomalies: facts.anomalies,
      ownerActions: (facts.topActions || []).slice(0, 3).map((a) => ({
        title: a.suggestedAction || a.reason,
        clientId: a.clientId,
        expectedValue: a.expectedValue || 0,
        why: a.reason,
      })),
      revenueAtRisk: facts.revenueAtRisk || 0,
      source: 'rule',
      fromCache: false,
    };

    res.json({ success: true, data: { ...data, facts } });

    const { runDailyAiAnalyses } = require('../services/commercialIntelligence.service');
    setImmediate(() => {
      runDailyAiAnalyses(req.userId, { directorFacts: facts }).catch(() => {});
    });
  } catch (error) {
    next(error);
  }
}

async function prepareLead(req, res, next) {
  try {
    const data = await prepareLeadBundle(req.userId, req.params.clientId);
    res.json({ success: true, data });
  } catch (error) {
    if (error.statusCode === 404) {
      return res.status(404).json({ success: false, error: error.message });
    }
    next(error);
  }
}

async function getContext(req, res, next) {
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

async function agnoStatus(req, res, next) {
  try {
    const health = await healthCheck();
    res.json({
      success: true,
      data: {
        enabled: isAgnoEnabled(),
        reachable: Boolean(health?.ok || health?.success || health?.status === 'ok'),
        health,
      },
    });
  } catch (error) {
    next(error);
  }
}

async function learning(req, res, next) {
  try {
    const days = Number(req.query.days) || 30;
    const data = await getLearningSignals(req.userId, { days });
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

async function reactivationTargets(req, res, next) {
  try {
    const {
      collectReactivationTargets,
    } = require('../services/reactivation.service');
    const targets = await collectReactivationTargets(req.userId);
    res.json({ success: true, data: { targets } });
  } catch (error) {
    next(error);
  }
}

async function reactivationGenerate(req, res, next) {
  try {
    const { generateReactivationCampaign } = require('../services/reactivation.service');
    const data = await generateReactivationCampaign(req.userId);
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

async function reactivationContacted(req, res, next) {
  try {
    const { markReactivationContacted } = require('../services/reactivation.service');
    const data = await markReactivationContacted(
      req.userId,
      req.params.clientId,
      req.body?.note
    );
    res.json({ success: true, data });
  } catch (error) {
    if (error.statusCode === 404) {
      return res.status(404).json({ success: false, error: error.message });
    }
    next(error);
  }
}

module.exports = {
  qualify,
  offer,
  objection,
  conversation,
  approveJourney,
  advanceJourney,
  moveJourney,
  closingQueue,
  director,
  prepareLead,
  getContext,
  agnoStatus,
  learning,
  reactivationTargets,
  reactivationGenerate,
  reactivationContacted,
};
