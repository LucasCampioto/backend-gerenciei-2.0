const StockItem = require('../models/StockItem');
const mongoose = require('mongoose');

function formatStockItem(item) {
  const obj = item.toObject();
  return {
    id: obj._id.toString(),
    name: obj.name,
    quantity: obj.quantity,
    unit: obj.unit,
    minQuantity: obj.minQuantity,
    totalCost: obj.totalCost ?? null,
    unitCost: obj.unitCost ?? null,
    notes: obj.notes || '',
    active: obj.active !== false,
    createdAt: obj.createdAt,
    updatedAt: obj.updatedAt,
  };
}

function normalizeOptionalCost(value) {
  if (value == null || value === '') return null;
  return value;
}

async function getAllStockItems(req, res, next) {
  try {
    const { q, lowOnly } = req.query;
    const query = { userId: req.userId };

    if (typeof q === 'string' && q.trim()) {
      query.name = { $regex: q.trim(), $options: 'i' };
    }

    let items = await StockItem.find(query).sort({ name: 1 });

    if (lowOnly === 'true' || lowOnly === '1') {
      items = items.filter((item) => item.quantity <= item.minQuantity);
    }

    res.json({
      success: true,
      data: items.map(formatStockItem),
    });
  } catch (error) {
    next(error);
  }
}

async function createStockItem(req, res, next) {
  try {
    const { name, quantity, unit, minQuantity, totalCost, unitCost, notes, active } = req.body;

    const item = new StockItem({
      userId: req.userId,
      name,
      quantity,
      unit,
      minQuantity,
      totalCost: normalizeOptionalCost(totalCost),
      unitCost: normalizeOptionalCost(unitCost),
      notes: notes || '',
      active: active !== false,
    });

    await item.save();

    res.status(201).json({
      success: true,
      data: formatStockItem(item),
      message: 'Item de estoque criado com sucesso',
    });
  } catch (error) {
    next(error);
  }
}

async function updateStockItem(req, res, next) {
  try {
    const { id } = req.params;
    const { name, quantity, unit, minQuantity, totalCost, unitCost, notes, active } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        error: 'ID inválido',
      });
    }

    const item = await StockItem.findOneAndUpdate(
      { _id: id, userId: req.userId },
      {
        name,
        quantity,
        unit,
        minQuantity,
        totalCost: normalizeOptionalCost(totalCost),
        unitCost: normalizeOptionalCost(unitCost),
        notes: notes || '',
        ...(typeof active === 'boolean' ? { active } : {}),
      },
      { new: true, runValidators: true }
    );

    if (!item) {
      return res.status(404).json({
        success: false,
        error: 'Item de estoque não encontrado',
      });
    }

    res.json({
      success: true,
      data: formatStockItem(item),
      message: 'Item de estoque atualizado com sucesso',
    });
  } catch (error) {
    next(error);
  }
}

async function deleteStockItem(req, res, next) {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        error: 'ID inválido',
      });
    }

    const item = await StockItem.findOneAndDelete({ _id: id, userId: req.userId });

    if (!item) {
      return res.status(404).json({
        success: false,
        error: 'Item de estoque não encontrado',
      });
    }

    res.json({
      success: true,
      data: null,
      message: 'Item de estoque excluído com sucesso',
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getAllStockItems,
  createStockItem,
  updateStockItem,
  deleteStockItem,
};
