const Employee = require('../models/Employee');
const User = require('../models/User');
const Procedure = require('../models/Procedure');
const mongoose = require('mongoose');
const {
  tenantFilter,
  tenantCreateFields,
  andFilters,
} = require('../utils/tenantScope');

function formatEmployee(employee) {
  const obj = employee.toObject ? employee.toObject() : employee;
  return {
    id: obj._id,
    name: obj.name,
    email: obj.email,
    phone: obj.phone,
    linkedUserId: obj.linkedUserId ? String(obj.linkedUserId) : null,
    generalCommission: obj.generalCommission,
    procedureCommissions: (obj.procedureCommissions || []).map(pc => ({
      procedureId: pc.procedureId,
      percentage: pc.percentage
    })),
    createdAt: obj.createdAt
  };
}

/**
 * Garante um registro de colaborador (comissões) para o usuário logado.
 * Usado na venda: membro fica preso a si; admin aparece na lista.
 */
async function ensureMeAsEmployee(req, res, next) {
  try {
    const user = await User.findById(req.userId).select('name email').lean();
    if (!user) {
      return res.status(404).json({ success: false, error: 'Usuário não encontrado' });
    }

    const actorId = new mongoose.Types.ObjectId(req.userId);
    const email = (user.email || '').toLowerCase().trim();
    const scope = tenantFilter(req);

    let employee = await Employee.findOne(andFilters(scope, { linkedUserId: actorId }));

    if (!employee && email) {
      employee = await Employee.findOne(andFilters(scope, { email }));
      if (employee) {
        employee.linkedUserId = actorId;
        if (user.name && (!employee.name || employee.name.trim() === '')) {
          employee.name = user.name;
        }
        await employee.save();
      }
    }

    if (!employee) {
      employee = new Employee({
        ...tenantCreateFields(req),
        linkedUserId: actorId,
        name: user.name || email || 'Colaborador',
        email: email || undefined,
        generalCommission: 0,
        procedureCommissions: [],
      });
      await employee.save();
    }

    res.json({
      success: true,
      data: formatEmployee(employee),
    });
  } catch (error) {
    next(error);
  }
}

async function getAllEmployees(req, res, next) {
  try {
    const employees = await Employee.find({ ...tenantFilter(req) })
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
      ...tenantCreateFields(req),
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
      { _id: id, ...tenantFilter(req) },
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
      _id: id, ...tenantFilter(req)
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
      _id: id, ...tenantFilter(req)
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
  ensureMeAsEmployee,
  createEmployee,
  updateEmployee,
  deleteEmployee,
  getEmployeeCommission
};

