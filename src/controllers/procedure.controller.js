const Procedure = require('../models/Procedure');
const mongoose = require('mongoose');

// Converter _id para id e remover campos internos
function formatProcedure(procedure) {
  const obj = procedure.toObject();
  return {
    id: obj._id,
    name: obj.name,
    description: obj.description,
    value: obj.value,
    createdAt: obj.createdAt
  };
}

async function getAllProcedures(req, res, next) {
  try {
    const procedures = await Procedure.find({ userId: req.userId })
      .sort({ createdAt: -1 });
    
    res.json({
      success: true,
      data: procedures.map(formatProcedure)
    });
  } catch (error) {
    next(error);
  }
}

async function createProcedure(req, res, next) {
  try {
    const { name, description, value } = req.body;
    
    const procedure = new Procedure({
      userId: req.userId,
      name,
      description,
      value
    });
    
    await procedure.save();
    
    res.status(201).json({
      success: true,
      data: formatProcedure(procedure),
      message: 'Procedimento criado com sucesso'
    });
  } catch (error) {
    next(error);
  }
}

async function updateProcedure(req, res, next) {
  try {
    const { id } = req.params;
    const { name, description, value } = req.body;
    
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        error: 'ID inválido'
      });
    }
    
    const procedure = await Procedure.findOneAndUpdate(
      { _id: id, userId: req.userId },
      { name, description, value },
      { new: true, runValidators: true }
    );
    
    if (!procedure) {
      return res.status(404).json({
        success: false,
        error: 'Procedimento não encontrado'
      });
    }
    
    res.json({
      success: true,
      data: formatProcedure(procedure),
      message: 'Procedimento atualizado com sucesso'
    });
  } catch (error) {
    next(error);
  }
}

async function deleteProcedure(req, res, next) {
  try {
    const { id } = req.params;
    
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        error: 'ID inválido'
      });
    }
    
    const procedure = await Procedure.findOneAndDelete({
      _id: id,
      userId: req.userId
    });
    
    if (!procedure) {
      return res.status(404).json({
        success: false,
        error: 'Procedimento não encontrado'
      });
    }
    
    res.json({
      success: true,
      message: 'Procedimento removido com sucesso'
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getAllProcedures,
  createProcedure,
  updateProcedure,
  deleteProcedure
};

