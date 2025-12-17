const Sale = require('../models/Sale');
const Employee = require('../models/Employee');
const mongoose = require('mongoose');

function formatSale(sale) {
  const obj = sale.toObject();
  return {
    id: obj._id.toString(),
    items: obj.items.map(item => ({
      procedureId: item.procedureId ? item.procedureId.toString() : item.procedureId,
      procedureName: item.procedureName,
      quantity: item.quantity,
      unitValue: item.unitValue,
      totalValue: item.totalValue
    })),
    totalValue: obj.totalValue,
    commissionValue: obj.commissionValue,
    netValue: obj.netValue,
    employeeId: obj.employeeId ? obj.employeeId.toString() : obj.employeeId,
    employeeName: obj.employeeName,
    createdAt: obj.createdAt
  };
}

async function getAllSales(req, res, next) {
  try {
    const { startDate, endDate, employeeId, page = 1, limit = 10 } = req.query;
    
    const query = { userId: req.userId };
    
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) query.createdAt.$lte = new Date(endDate);
    }
    
    if (employeeId && mongoose.Types.ObjectId.isValid(employeeId)) {
      query.employeeId = employeeId;
    }
    
    // Converter page e limit para números
    const pageNum = parseInt(page, 10) || 1;
    const limitNum = parseInt(limit, 10) || 10;
    const skip = (pageNum - 1) * limitNum;
    
    // Buscar total de documentos
    const total = await Sale.countDocuments(query);
    
    // Buscar documentos paginados
    const sales = await Sale.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum);
    
    // Calcular informações de paginação
    const totalPages = Math.ceil(total / limitNum);
    const hasNextPage = pageNum < totalPages;
    const hasPrevPage = pageNum > 1;

    // Buscar todas as vendas (sem paginação) para calcular resumo por colaborador
    const allSalesQuery = { 
      userId: req.userId,
      employeeId: { $exists: true, $ne: null } // Apenas vendas com employeeId válido
    };
    
    if (startDate || endDate) {
      allSalesQuery.createdAt = {};
      if (startDate) allSalesQuery.createdAt.$gte = new Date(startDate);
      if (endDate) allSalesQuery.createdAt.$lte = new Date(endDate);
    }
    
    // Se houver filtro específico de employeeId, aplicar
    if (employeeId && mongoose.Types.ObjectId.isValid(employeeId)) {
      allSalesQuery.employeeId = new mongoose.Types.ObjectId(employeeId);
    }

    const allSales = await Sale.find(allSalesQuery);

    // Agrupar vendas por colaborador
    const salesByEmployee = {};
    
    allSales.forEach(sale => {
      if (sale.employeeId) {
        const empId = sale.employeeId.toString();
        
        if (!salesByEmployee[empId]) {
          salesByEmployee[empId] = {
            employeeId: empId,
            employeeName: sale.employeeName || '',
            sales: [],
            totalSalesValue: 0,
            totalCommission: 0
          };
        }
        
        salesByEmployee[empId].sales.push(sale);
        salesByEmployee[empId].totalSalesValue += sale.totalValue || 0;
        salesByEmployee[empId].totalCommission += sale.commissionValue || 0;
      }
    });

    // Buscar dados dos colaboradores e calcular percentual médio
    const summaryByEmployee = await Promise.all(
      Object.values(salesByEmployee).map(async (employeeData) => {
        try {
          const employee = await Employee.findOne({
            _id: employeeData.employeeId,
            userId: req.userId
          });

          const salesCount = employeeData.sales.length;
          const totalSalesValue = employeeData.totalSalesValue;
          const totalCommission = employeeData.totalCommission;
          
          // Calcular percentual médio de comissão
          // (totalCommission / totalSalesValue) * 100
          const averageCommissionPercentage = totalSalesValue > 0 
            ? (totalCommission / totalSalesValue) * 100 
            : 0;

          return {
            employeeId: employeeData.employeeId,
            employeeName: employee?.name || employeeData.employeeName || 'Colaborador não encontrado',
            totalSalesValue: Math.round(totalSalesValue * 100) / 100, // Arredondar para 2 casas
            salesCount,
            totalCommission: Math.round(totalCommission * 100) / 100, // Arredondar para 2 casas
            averageCommissionPercentage: Math.round(averageCommissionPercentage * 100) / 100 // Arredondar para 2 casas
          };
        } catch (error) {
          console.error('Erro ao buscar colaborador:', error);
          return {
            employeeId: employeeData.employeeId,
            employeeName: employeeData.employeeName || 'Colaborador não encontrado',
            totalSalesValue: Math.round(employeeData.totalSalesValue * 100) / 100,
            salesCount: employeeData.sales.length,
            totalCommission: Math.round(employeeData.totalCommission * 100) / 100,
            averageCommissionPercentage: employeeData.totalSalesValue > 0
              ? Math.round((employeeData.totalCommission / employeeData.totalSalesValue) * 100 * 100) / 100
              : 0
          };
        }
      })
    );

    // Ordenar por total de vendas (maior para menor)
    summaryByEmployee.sort((a, b) => b.totalSalesValue - a.totalSalesValue);
    
    res.json({
      success: true,
      data: sales.map(formatSale),
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages,
        hasNextPage,
        hasPrevPage,
        success: true
      },
      summaryByEmployee
    });
  } catch (error) {
    next(error);
  }
}

async function createSale(req, res, next) {
  try {
    const { items, totalValue, commissionValue, netValue, employeeId, employeeName } = req.body;
    
    // Calcular netValue se não fornecido
    const calculatedNetValue = netValue !== undefined 
      ? netValue 
      : totalValue - (commissionValue || 0);
    
    const sale = new Sale({
      userId: req.userId,
      items,
      totalValue,
      commissionValue: commissionValue || 0,
      netValue: calculatedNetValue,
      employeeId: employeeId || undefined,
      employeeName: employeeName || undefined
    });
    
    await sale.save();
    
    res.status(201).json({
      success: true,
      data: formatSale(sale),
      message: 'Venda criada com sucesso'
    });
  } catch (error) {
    next(error);
  }
}

async function deleteSale(req, res, next) {
  try {
    const { id } = req.params;
    
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        error: 'ID inválido'
      });
    }
    
    const sale = await Sale.findOneAndDelete({
      _id: id,
      userId: req.userId
    });
    
    if (!sale) {
      return res.status(404).json({
        success: false,
        error: 'Venda não encontrada'
      });
    }
    
    res.json({
      success: true,
      message: 'Venda removida com sucesso'
    });
  } catch (error) {
    next(error);
  }
}

async function getSalesByEmployee(req, res, next) {
  try {
    const { employeeId } = req.params;
    
    if (!mongoose.Types.ObjectId.isValid(employeeId)) {
      return res.status(400).json({
        success: false,
        error: 'ID do colaborador inválido'
      });
    }
    
    const sales = await Sale.find({
      userId: req.userId,
      employeeId
    }).sort({ createdAt: -1 });
    
    res.json({
      success: true,
      data: sales.map(formatSale)
    });
  } catch (error) {
    next(error);
  }
}

async function getEmployeeSalesTotal(req, res, next) {
  try {
    const { employeeId } = req.params;
    
    if (!mongoose.Types.ObjectId.isValid(employeeId)) {
      return res.status(400).json({
        success: false,
        error: 'ID do colaborador inválido'
      });
    }
    
    const result = await Sale.aggregate([
      {
        $match: {
          userId: new mongoose.Types.ObjectId(req.userId),
          employeeId: new mongoose.Types.ObjectId(employeeId)
        }
      },
      {
        $group: {
          _id: null,
          total: { $sum: '$totalValue' }
        }
      }
    ]);
    
    const total = result.length > 0 ? result[0].total : 0;
    
    res.json({
      success: true,
      data: { total }
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getAllSales,
  createSale,
  deleteSale,
  getSalesByEmployee,
  getEmployeeSalesTotal
};

