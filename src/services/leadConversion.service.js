const mongoose = require('mongoose');
const Client = require('../models/Client');
const Sale = require('../models/Sale');
const { logActivity } = require('./clientActivity.service');
const { stripPhoneDigits, findClientByPhone } = require('../utils/phoneMatch');

/**
 * Promove lead → cliente (com venda / sincronização).
 * Retorna true se alterou o documento.
 */
async function promoteLeadToClient(userId, client, { reason = 'venda', save = true } = {}) {
  if (!client || client.category === 'cliente') {
    if (client && client.pipelineStage !== 'won' && client.pipelineStage !== 'lost') {
      client.pipelineStage = 'won';
      if (save) await client.save();
      return true;
    }
    return false;
  }

  client.category = 'cliente';
  client.convertedAt = new Date();
  client.pipelineStage = 'won';
  if (save) await client.save();

  await logActivity({
    userId,
    clientId: client._id,
    clientName: client.name,
    type: 'note',
    content:
      reason === 'sync'
        ? 'Convertido de lead para cliente (já havia venda registrada)'
        : 'Convertido de lead para cliente (venda registrada)',
  }).catch(() => {});

  return true;
}

/**
 * Resolve o cliente da venda (por id ou telefone) e promove se for lead.
 */
async function promoteLeadFromSale(userId, { clientId, clientPhone } = {}) {
  let client = null;

  if (clientId && mongoose.Types.ObjectId.isValid(clientId)) {
    client = await Client.findOne({ _id: clientId, userId });
  }

  if (!client && clientPhone) {
    client = await findClientByPhone(Client, userId, clientPhone);
  }

  if (!client) return null;

  await promoteLeadToClient(userId, client, { reason: 'venda' });
  return client;
}

/**
 * Varre leads do usuário: se tiverem venda (por clientId ou telefone), vira cliente.
 * Retorna quantos foram convertidos.
 */
async function syncLeadsWithSales(userId) {
  const userObjectId = new mongoose.Types.ObjectId(userId);

  const soldClientIds = await Sale.distinct('clientId', {
    userId: userObjectId,
    clientId: { $exists: true, $ne: null },
  });

  let converted = 0;

  if (soldClientIds.length) {
    const leads = await Client.find({
      userId: userObjectId,
      category: 'lead',
      _id: { $in: soldClientIds },
    });

    for (const lead of leads) {
      const ok = await promoteLeadToClient(userId, lead, { reason: 'sync' });
      if (ok) converted += 1;
    }
  }

  // Leads restantes: match por telefone em vendas (sem clientId ou com outro id)
  const remainingLeads = await Client.find({
    userId: userObjectId,
    category: 'lead',
  })
    .select('_id name phone')
    .lean();

  if (!remainingLeads.length) {
    return { converted };
  }

  const phoneToLeadId = new Map();
  for (const lead of remainingLeads) {
    const digits = stripPhoneDigits(lead.phone || '');
    if (digits && digits.length >= 8) {
      phoneToLeadId.set(digits, lead._id.toString());
      // também chave sem DDI 55
      if (digits.startsWith('55') && digits.length >= 12) {
        phoneToLeadId.set(digits.slice(2), lead._id.toString());
      }
    }
  }

  if (!phoneToLeadId.size) {
    return { converted };
  }

  const phoneSales = await Sale.find({
    userId: userObjectId,
    clientPhone: { $exists: true, $nin: [null, ''] },
  })
    .select('clientPhone')
    .lean();

  const leadIdsFromPhone = new Set();
  for (const sale of phoneSales) {
    const digits = stripPhoneDigits(sale.clientPhone || '');
    if (!digits) continue;
    const id =
      phoneToLeadId.get(digits) ||
      (digits.startsWith('55') ? phoneToLeadId.get(digits.slice(2)) : null) ||
      phoneToLeadId.get(`55${digits}`);
    if (id) leadIdsFromPhone.add(id);
  }

  if (leadIdsFromPhone.size) {
    const leadsByPhone = await Client.find({
      userId: userObjectId,
      category: 'lead',
      _id: { $in: [...leadIdsFromPhone] },
    });
    for (const lead of leadsByPhone) {
      const ok = await promoteLeadToClient(userId, lead, { reason: 'sync' });
      if (ok) converted += 1;
    }
  }

  return { converted };
}

module.exports = {
  promoteLeadToClient,
  promoteLeadFromSale,
  syncLeadsWithSales,
};
