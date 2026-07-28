const Client = require('../models/Client');
const ClientActivity = require('../models/ClientActivity');
const Campaign = require('../models/Campaign');
const CampaignLead = require('../models/CampaignLead');
const mongoose = require('mongoose');
const { logActivity } = require('../services/clientActivity.service');
const { recordClientPhotoConsent } = require('../services/simulation/clientPhotoConsent');
const {
  findClientByPhone,
  isValidBrazilianPhone,
  stripPhoneDigits,
} = require('../utils/phoneMatch');

function formatClient(client) {
  const obj = client.toObject ? client.toObject() : client;
  const createdAt = obj.createdAt ?? client.createdAt;

  return {
    id: (obj._id ?? client._id).toString(),
    name: obj.name,
    phone: obj.phone,
    category: obj.category,
    isNewClient: obj.isNewClient ?? obj.isNew ?? true,
    convertedAt: obj.convertedAt
      ? (obj.convertedAt instanceof Date ? obj.convertedAt.toISOString() : obj.convertedAt)
      : null,
    clientGroup: obj.clientGroup ?? 'grupo_a',
    noReturnReason: obj.noReturnReason ?? '',
    leadSource: obj.leadSource ?? null,
    leadSourceOther: obj.leadSourceOther ?? '',
    photoConsentAt: obj.photoConsentAt
      ? (obj.photoConsentAt instanceof Date ? obj.photoConsentAt.toISOString() : obj.photoConsentAt)
      : undefined,
    photoConsentVersion: obj.photoConsentVersion || undefined,
    createdAt: createdAt instanceof Date
      ? createdAt.toISOString()
      : createdAt ?? new Date().toISOString()
  };
}

async function getAllClients(req, res, next) {
  try {
    const { category } = req.query;
    const query = { userId: req.userId };

    if (category && ['lead', 'cliente'].includes(category)) {
      query.category = category;
    }

    const clients = await Client.find(query).sort({ createdAt: -1 });

    res.json({
      success: true,
      data: clients.map(formatClient)
    });
  } catch (error) {
    next(error);
  }
}

async function createClient(req, res, next) {
  try {
    const { name, phone, category, isNewClient, clientGroup, noReturnReason, leadSource, leadSourceOther } = req.body;

    if (!isValidBrazilianPhone(phone)) {
      return res.status(400).json({
        success: false,
        error: 'Telefone inválido. Informe DDD + número.',
      });
    }

    const phoneDigits = stripPhoneDigits(phone);
    const duplicate = await findClientByPhone(Client, req.userId, phoneDigits);
    if (duplicate) {
      return res.status(409).json({
        success: false,
        error: 'Já existe um lead/cliente cadastrado com este telefone.',
        data: formatClient(duplicate),
      });
    }

    const client = new Client({
      userId: req.userId,
      name,
      phone: phoneDigits,
      category: category || 'lead',
      isNewClient: isNewClient !== undefined ? isNewClient : true,
      clientGroup: clientGroup || 'grupo_a',
      noReturnReason: noReturnReason || '',
      leadSource: leadSource || null,
      leadSourceOther: leadSource === 'outros' ? (leadSourceOther || '').trim() : '',
      convertedAt: category === 'cliente' ? new Date() : null,
    });

    await client.save();

    await logActivity({
      userId: req.userId,
      clientId: client._id,
      clientName: client.name,
      type: 'initial_group',
      toGroup: client.clientGroup,
      content: 'Cadastro inicial',
    });

    res.status(201).json({
      success: true,
      data: formatClient(client),
      message: 'Cliente cadastrado com sucesso'
    });
  } catch (error) {
    next(error);
  }
}

async function updateClient(req, res, next) {
  try {
    const { id } = req.params;
    const { name, phone, category, isNewClient, clientGroup, noReturnReason, leadSource, leadSourceOther } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        error: 'ID inválido'
      });
    }

    const existing = await Client.findOne({ _id: id, userId: req.userId });

    if (!existing) {
      return res.status(404).json({
        success: false,
        error: 'Cliente não encontrado'
      });
    }

    if (!isValidBrazilianPhone(phone)) {
      return res.status(400).json({
        success: false,
        error: 'Telefone inválido. Informe DDD + número.',
      });
    }

    const phoneDigits = stripPhoneDigits(phone);
    const duplicate = await findClientByPhone(Client, req.userId, phoneDigits);
    if (duplicate && String(duplicate._id) !== String(existing._id)) {
      return res.status(409).json({
        success: false,
        error: 'Já existe outro lead/cliente cadastrado com este telefone.',
        data: formatClient(duplicate),
      });
    }

    const updateData = {
      name,
      phone: phoneDigits,
      category,
      isNewClient,
      clientGroup,
      noReturnReason,
      leadSource: leadSource || null,
      leadSourceOther: leadSource === 'outros' ? (leadSourceOther || '').trim() : '',
    };

    if (clientGroup !== undefined && clientGroup !== existing.clientGroup) {
      await logActivity({
        userId: req.userId,
        clientId: existing._id,
        clientName: existing.name,
        type: 'group_change',
        fromGroup: existing.clientGroup,
        toGroup: clientGroup,
        content: '',
      });
    }

    if (noReturnReason !== undefined && noReturnReason !== existing.noReturnReason) {
      await logActivity({
        userId: req.userId,
        clientId: existing._id,
        clientName: existing.name,
        type: 'reason_update',
        content: noReturnReason,
      });
    }

    if (category === 'cliente' && existing.category !== 'cliente') {
      updateData.convertedAt = new Date();
      const stageNow = existing.pipelineStage ?? 'new';
      if (
        !stageNow ||
        stageNow === 'new' ||
        stageNow === 'qualified' ||
        stageNow === 'proposal' ||
        stageNow === 'negotiation'
      ) {
        updateData.pipelineStage = 'won';
      }
    }

    if (category === 'lead') {
      updateData.convertedAt = null;
    }

    const client = await Client.findOneAndUpdate(
      { _id: id, userId: req.userId },
      updateData,
      { new: true, runValidators: true }
    );

    res.json({
      success: true,
      data: formatClient(client),
      message: 'Cliente atualizado com sucesso'
    });
  } catch (error) {
    next(error);
  }
}

async function deleteClient(req, res, next) {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        error: 'ID inválido'
      });
    }

    const client = await Client.findOneAndDelete({
      _id: id,
      userId: req.userId
    });

    if (!client) {
      return res.status(404).json({
        success: false,
        error: 'Cliente não encontrado'
      });
    }

    const campaignLeads = await CampaignLead.find({
      userId: req.userId,
      clientId: client._id,
    }).select('campaignId');

    await ClientActivity.deleteMany({
      userId: req.userId,
      clientId: client._id,
    });
    await CampaignLead.deleteMany({
      userId: req.userId,
      clientId: client._id,
    });

    const campaignIds = [
      ...new Set(campaignLeads.map((l) => String(l.campaignId)).filter(Boolean)),
    ];
    if (campaignIds.length) {
      await Campaign.updateMany(
        { _id: { $in: campaignIds }, userId: req.userId, leadsCount: { $gt: 0 } },
        { $inc: { leadsCount: -1 } }
      );
    }

    res.json({
      success: true,
      message: 'Cliente removido com sucesso'
    });
  } catch (error) {
    next(error);
  }
}

async function recordPhotoConsent(req, res, next) {
  try {
    const { consentVersion } = req.body || {};
    const result = await recordClientPhotoConsent(req.userId, req.params.id, { consentVersion });
    if (result.error) {
      return res.status(result.status || 400).json({
        success: false,
        error: result.error,
        message: result.error,
      });
    }
    res.json({
      success: true,
      data: formatClient(result.client),
      message: 'Consentimento registrado com sucesso',
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getAllClients,
  createClient,
  updateClient,
  deleteClient,
  recordPhotoConsent,
};
