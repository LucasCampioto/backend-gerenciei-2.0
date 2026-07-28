const mongoose = require('mongoose');
const Campaign = require('../models/Campaign');
const CampaignLead = require('../models/CampaignLead');
const Form = require('../models/Form');
const FormResponse = require('../models/FormResponse');
const Client = require('../models/Client');
const Sale = require('../models/Sale');

const STAGES = ['new', 'qualified', 'proposal', 'negotiation', 'won', 'lost'];

function emptyStages() {
  return STAGES.reduce((acc, s) => ({ ...acc, [s]: 0 }), {});
}

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

/**
 * Para um conjunto de clientIds, retorna { byStage, salesCount, salesAmount }.
 * clientStageMap: Map(clientId -> pipelineStage), salesMap: Map(clientId -> { count, amount }).
 */
function buildFunnelForClients(clientIds, clientStageMap, salesMap) {
  const byStage = emptyStages();
  let salesCount = 0;
  let salesAmount = 0;
  let clientsWithSale = 0;

  for (const id of clientIds) {
    const stage = clientStageMap.get(id) || 'new';
    if (byStage[stage] !== undefined) byStage[stage] += 1;
    else byStage.new += 1;

    const sale = salesMap.get(id);
    if (sale) {
      clientsWithSale += 1;
      salesCount += sale.count;
      salesAmount += sale.amount;
    }
  }

  return {
    leads: clientIds.length,
    byStage,
    clientsWithSale,
    salesCount,
    salesAmount: round2(salesAmount),
  };
}

async function loadClientStageMap(userObjectId, clientIds) {
  if (!clientIds.length) return new Map();
  const docs = await Client.find({
    userId: userObjectId,
    _id: { $in: clientIds },
  })
    .select('pipelineStage')
    .lean();
  return new Map(docs.map((c) => [c._id.toString(), c.pipelineStage || 'new']));
}

async function loadSalesMap(userObjectId, clientIds) {
  if (!clientIds.length) return new Map();
  const rows = await Sale.aggregate([
    {
      $match: {
        userId: userObjectId,
        clientId: { $in: clientIds },
        isDemo: { $ne: true },
      },
    },
    {
      $group: {
        _id: '$clientId',
        count: { $sum: 1 },
        amount: { $sum: '$netValue' },
      },
    },
  ]);
  return new Map(
    rows.map((r) => [r._id.toString(), { count: r.count, amount: r.amount || 0 }])
  );
}

/**
 * GET /api/reports/source-funnel
 * - ?campaignId=… → funil de uma campanha
 * - ?formId=…     → funil de um formulário
 * - sem params    → lista de todas as origens (campanhas + formulários) com funil resumido
 */
async function getSourceFunnel(req, res, next) {
  try {
    const userObjectId = new mongoose.Types.ObjectId(req.userId);
    const { campaignId, formId } = req.query;

    if (campaignId || formId) {
      let source = null;
      let clientIdSet = new Set();

      if (campaignId) {
        const campaign = await Campaign.findOne({
          _id: campaignId,
          userId: userObjectId,
        })
          .select('title type publicSlug status leadsCount visits')
          .lean();
        if (!campaign) {
          return res.status(404).json({ success: false, error: 'Campanha não encontrada' });
        }
        source = {
          sourceType: 'campaign',
          sourceId: campaign._id.toString(),
          title: campaign.title,
          status: campaign.status,
          visits: campaign.visits ?? null,
        };
        const leads = await CampaignLead.find({
          userId: userObjectId,
          campaignId: campaign._id,
        })
          .select('clientId')
          .lean();
        clientIdSet = new Set(leads.map((l) => l.clientId.toString()));
      } else {
        const form = await Form.findOne({ _id: formId, userId: userObjectId })
          .select('title status')
          .lean();
        if (!form) {
          return res.status(404).json({ success: false, error: 'Formulário não encontrado' });
        }
        source = {
          sourceType: 'form',
          sourceId: form._id.toString(),
          title: form.title,
          status: form.status ?? null,
          visits: null,
        };
        const responses = await FormResponse.find({
          userId: userObjectId,
          formId: form._id,
        })
          .select('clientId')
          .lean();
        clientIdSet = new Set(
          responses.filter((r) => r.clientId).map((r) => r.clientId.toString())
        );
      }

      const clientIds = [...clientIdSet];
      const clientObjectIds = clientIds.map((id) => new mongoose.Types.ObjectId(id));
      const [stageMap, salesMap] = await Promise.all([
        loadClientStageMap(userObjectId, clientObjectIds),
        loadSalesMap(userObjectId, clientObjectIds),
      ]);

      return res.json({
        success: true,
        data: {
          ...source,
          ...buildFunnelForClients(clientIds, stageMap, salesMap),
        },
      });
    }

    // Modo lista: todas as origens do usuário
    const [campaigns, forms, campaignLeadRows, formResponseRows] = await Promise.all([
      Campaign.find({ userId: userObjectId })
        .select('title status visits leadsCount')
        .lean(),
      Form.find({ userId: userObjectId }).select('title status').lean(),
      CampaignLead.aggregate([
        { $match: { userId: userObjectId } },
        { $group: { _id: '$campaignId', clientIds: { $addToSet: '$clientId' } } },
      ]),
      FormResponse.aggregate([
        { $match: { userId: userObjectId, clientId: { $ne: null } } },
        { $group: { _id: '$formId', clientIds: { $addToSet: '$clientId' } } },
      ]),
    ]);

    const campaignClientIds = new Map(
      campaignLeadRows.map((r) => [r._id.toString(), r.clientIds])
    );
    const formClientIds = new Map(
      formResponseRows.map((r) => [r._id.toString(), r.clientIds])
    );

    const allClientObjectIds = [
      ...campaignLeadRows.flatMap((r) => r.clientIds),
      ...formResponseRows.flatMap((r) => r.clientIds),
    ];
    const [stageMap, salesMap] = await Promise.all([
      loadClientStageMap(userObjectId, allClientObjectIds),
      loadSalesMap(userObjectId, allClientObjectIds),
    ]);

    const sources = [];

    for (const campaign of campaigns) {
      const ids = (campaignClientIds.get(campaign._id.toString()) || []).map((id) =>
        id.toString()
      );
      sources.push({
        sourceType: 'campaign',
        sourceId: campaign._id.toString(),
        title: campaign.title,
        status: campaign.status,
        visits: campaign.visits ?? null,
        ...buildFunnelForClients(ids, stageMap, salesMap),
      });
    }

    for (const form of forms) {
      const ids = (formClientIds.get(form._id.toString()) || []).map((id) => id.toString());
      sources.push({
        sourceType: 'form',
        sourceId: form._id.toString(),
        title: form.title,
        status: form.status ?? null,
        visits: null,
        ...buildFunnelForClients(ids, stageMap, salesMap),
      });
    }

    sources.sort((a, b) => b.leads - a.leads);

    res.json({ success: true, data: { sources } });
  } catch (error) {
    next(error);
  }
}

module.exports = { getSourceFunnel };
