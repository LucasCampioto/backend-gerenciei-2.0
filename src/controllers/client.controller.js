const Client = require('../models/Client');
const mongoose = require('mongoose');

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
    const { name, phone, category, isNewClient } = req.body;

    const client = new Client({
      userId: req.userId,
      name,
      phone,
      category: category || 'lead',
      isNewClient: isNewClient !== undefined ? isNewClient : true,
      convertedAt: category === 'cliente' ? new Date() : null,
    });

    await client.save();

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
    const { name, phone, category, isNewClient } = req.body;

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

    const updateData = { name, phone, category, isNewClient };

    if (category === 'cliente' && existing.category !== 'cliente') {
      updateData.convertedAt = new Date();
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

    res.json({
      success: true,
      message: 'Cliente removido com sucesso'
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getAllClients,
  createClient,
  updateClient,
  deleteClient
};
