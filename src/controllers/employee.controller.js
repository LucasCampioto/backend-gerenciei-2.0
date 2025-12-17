const Employee = require('../models/Employee');
const Procedure = require('../models/Procedure');
const mongoose = require('mongoose');

function formatEmployee(employee) {
  const obj = employee.toObject();
  return {
    id: obj._id,
    name: obj.name,
    email: obj.email,
    phone: obj.phone,
    generalCommission: obj.generalCommission,
    procedureCommissions: obj.procedureCommissions.map(pc => ({
      procedureId: pc.procedureId,
      percentage: pc.percentage
    })),
    createdAt: obj.createdAt
  };
}

async function getAllEmployees(req, res, next) {
  try {
    const employees = await Employee.find({ userId: req.userId })
      .sort({ createdAt: -1 });
    
    res.json({
      success: true,
      data: employees.map(formatEmployee)
    });
  } catch (error) {
    next(error);
  }
}

async function createEmployee(req, res, next) {
  try {
    const { name, email, phone, generalCommission, procedureCommissions } = req.body;
    
    const employee = new Employee({
      userId: req.userId,
      name,
      email: email || undefined,
      phone: phone || undefined,
      generalCommission,
      procedureCommissions: procedureCommissions || []
    });
    
    await employee.save();
    
    res.status(201).json({
      success: true,
      data: formatEmployee(employee),
      message: 'Colaborador criado com sucesso'
    });
  } catch (error) {
    next(error);
  }
}

async function updateEmployee(req, res, next) {
  try {
    const { id } = req.params;
    const { name, email, phone, generalCommission, procedureCommissions } = req.body;
    
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        error: 'ID inválido'
      });
    }
    
    const updateData = {
      name,
      generalCommission,
      procedureCommissions: procedureCommissions || []
    };
    
    if (email !== undefined) updateData.email = email || undefined;
    if (phone !== undefined) updateData.phone = phone || undefined;
    
    const employee = await Employee.findOneAndUpdate(
      { _id: id, userId: req.userId },
      updateData,
      { new: true, runValidators: true }
    );
    
    if (!employee) {
      return res.status(404).json({
        success: false,
        error: 'Colaborador não encontrado'
      });
    }
    
    res.json({
      success: true,
      data: formatEmployee(employee),
      message: 'Colaborador atualizado com sucesso'
    });
  } catch (error) {
    next(error);
  }
}

async function deleteEmployee(req, res, next) {
  try {
    const { id } = req.params;
    
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        error: 'ID inválido'
      });
    }
    
    const employee = await Employee.findOneAndDelete({
      _id: id,
      userId: req.userId
    });
    
    if (!employee) {
      return res.status(404).json({
        success: false,
        error: 'Colaborador não encontrado'
      });
    }
    
    res.json({
      success: true,
      message: 'Colaborador removido com sucesso'
    });
  } catch (error) {
    next(error);
  }
}

async function getEmployeeCommission(req, res, next) {
  try {
    const { id, procedureId } = req.params;
    
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        error: 'ID do colaborador inválido'
      });
    }
    
    const employee = await Employee.findOne({
      _id: id,
      userId: req.userId
    });
    
    if (!employee) {
      return res.json({
        success: true,
        data: { commission: 0 }
      });
    }
    
    // Buscar comissão específica do procedimento
    if (procedureId && mongoose.Types.ObjectId.isValid(procedureId)) {
      const specificCommission = employee.procedureCommissions.find(
        pc => pc.procedureId.toString() === procedureId
      );
      
      if (specificCommission) {
        return res.json({
          success: true,
          data: { commission: specificCommission.percentage }
        });
      }
    }
    
    // Retornar comissão geral
    res.json({
      success: true,
      data: { commission: employee.generalCommission }
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getAllEmployees,
  createEmployee,
  updateEmployee,
  deleteEmployee,
  getEmployeeCommission
};

