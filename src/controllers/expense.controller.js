const Expense = require('../models/Expense');
const mongoose = require('mongoose');

function formatExpense(expense) {
  const obj = expense.toObject();
  return {
    id: obj._id.toString(),
    description: obj.description,
    value: obj.value,
    category: obj.category,
    createdAt: obj.createdAt
  };
}

async function getAllExpenses(req, res, next) {
  try {
    const { startDate, endDate, category, page = 1, limit = 10 } = req.query;
    
    const query = { userId: req.userId };
    
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) {
        query.createdAt.$gte = new Date(startDate);
      }
      if (endDate) {
        const parsedEndDate = new Date(endDate);
        // Se endDate não tem horário (apenas data), ajustar para final do dia em UTC
        // Verificar se a string original não tinha horário (formato YYYY-MM-DD)
        if (typeof endDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(endDate.trim())) {
          parsedEndDate.setUTCHours(23, 59, 59, 999);
        }
        query.createdAt.$lte = parsedEndDate;
      }
    }
    
    if (category) {
      query.category = category;
    }
    
    // Converter page e limit para números
    const pageNum = parseInt(page, 10) || 1;
    const limitNum = parseInt(limit, 10) || 10;
    const skip = (pageNum - 1) * limitNum;
    
    // Buscar total de documentos
    const total = await Expense.countDocuments(query);
    
    // Buscar documentos paginados
    const expenses = await Expense.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum);
    
    // Calcular informações de paginação
    const totalPages = Math.ceil(total / limitNum);
    const hasNextPage = pageNum < totalPages;
    const hasPrevPage = pageNum > 1;
    
    res.json({
      success: true,
      data: expenses.map(formatExpense),
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages,
        hasNextPage,
        hasPrevPage,
        success: true
      }
    });
  } catch (error) {
    next(error);
  }
}

async function createExpense(req, res, next) {
  try {
    const { description, value, category } = req.body;
    
    const expense = new Expense({
      userId: req.userId,
      description,
      value,
      category
    });
    
    await expense.save();
    
    res.status(201).json({
      success: true,
      data: formatExpense(expense),
      message: 'Gasto criado com sucesso'
    });
  } catch (error) {
    next(error);
  }
}

async function updateExpense(req, res, next) {
  try {
    const { id } = req.params;
    const { description, value, category } = req.body;
    
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        error: 'ID inválido'
      });
    }
    
    const expense = await Expense.findOneAndUpdate(
      { _id: id, userId: req.userId },
      { description, value, category },
      { new: true, runValidators: true }
    );
    
    if (!expense) {
      return res.status(404).json({
        success: false,
        error: 'Gasto não encontrado'
      });
    }
    
    res.json({
      success: true,
      data: formatExpense(expense),
      message: 'Gasto atualizado com sucesso'
    });
  } catch (error) {
    next(error);
  }
}

async function deleteExpense(req, res, next) {
  try {
    const { id } = req.params;
    
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        error: 'ID inválido'
      });
    }
    
    const expense = await Expense.findOneAndDelete({
      _id: id,
      userId: req.userId
    });
    
    if (!expense) {
      return res.status(404).json({
        success: false,
        error: 'Gasto não encontrado'
      });
    }
    
    res.json({
      success: true,
      message: 'Gasto removido com sucesso'
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getAllExpenses,
  createExpense,
  updateExpense,
  deleteExpense
};

