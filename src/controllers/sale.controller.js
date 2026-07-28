const Sale = require('../models/Sale');
const Employee = require('../models/Employee');
const Client = require('../models/Client');
const mongoose = require('mongoose');
const { getFeePercentageForUser, round2 } = require('./paymentFee.controller');
const { logActivity } = require('../services/clientActivity.service');
const CommercialAction = require('../models/CommercialAction');
const {
  promoteLeadFromSale,
  syncLeadsWithSales,
} = require('../services/leadConversion.service');

/** Datas YYYY-MM-DD no fuso da clínica (Brasília). */
const CLINIC_TZ_OFFSET = '-03:00';

function parseClinicDayStart(dateStr) {
  if (typeof dateStr === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateStr.trim())) {
    return new Date(`${dateStr.trim()}T00:00:00.000${CLINIC_TZ_OFFSET}`);
  }
  return new Date(dateStr);
}

function parseClinicDayEnd(dateStr) {
  if (typeof dateStr === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateStr.trim())) {
    return new Date(`${dateStr.trim()}T23:59:59.999${CLINIC_TZ_OFFSET}`);
  }
  return new Date(dateStr);
}

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
    paymentMethod: obj.paymentMethod,
    paymentFeePercentage: obj.paymentFeePercentage ?? 0,
    paymentFeeValue: obj.paymentFeeValue ?? 0,
    cardBrandGroup: obj.cardBrandGroup ?? 'default',
    installments: obj.installments ?? 1,
    discount: obj.discount || 0,
    employeeId: obj.employeeId ? obj.employeeId.toString() : obj.employeeId,
    employeeName: obj.employeeName,
    clientId: obj.clientId ? obj.clientId.toString() : obj.clientId,
    clientName: obj.clientName,
    clientPhone: obj.clientPhone,
    createdAt: obj.createdAt
  };
}

async function getAllSales(req, res, next) {
  try {
    // Garante: lead com venda → cliente
    await syncLeadsWithSales(req.userId).catch(() => {});

    const { startDate, endDate, employeeId, clientId, page = 1, limit = 10 } = req.query;
    
    const query = { userId: req.userId };
    
    if (startDate || endDate) {
      query.createdAt = {};
      
      if (startDate) {
        query.createdAt.$gte = parseClinicDayStart(startDate);
      }
      if (endDate) {
        query.createdAt.$lte = parseClinicDayEnd(endDate);
      }
    }
    
    if (employeeId && mongoose.Types.ObjectId.isValid(employeeId)) {
      query.employeeId = employeeId;
    }

    if (clientId && mongoose.Types.ObjectId.isValid(clientId)) {
      query.clientId = clientId;
    }

    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
    if (search) {
      const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(escaped, 'i');
      query.$or = [
        { clientName: regex },
        { clientPhone: regex },
        { 'items.procedureName': regex },
      ];
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
      if (startDate) {
        allSalesQuery.createdAt.$gte = parseClinicDayStart(startDate);
      }
      if (endDate) {
        allSalesQuery.createdAt.$lte = parseClinicDayEnd(endDate);
      }
    }
    
    // Se houver filtro específico de employeeId, aplicar
    if (employeeId && mongoose.Types.ObjectId.isValid(employeeId)) {
      allSalesQuery.employeeId = new mongoose.Types.ObjectId(employeeId);
    }

    if (search) {
      const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(escaped, 'i');
      allSalesQuery.$or = [
        { clientName: regex },
        { clientPhone: regex },
        { 'items.procedureName': regex },
      ];
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
    
    // Calcular total líquido de TODAS as vendas (não apenas as paginadas)
    const totalNetValue = allSales.reduce((sum, s) => sum + (s.netValue || 0), 0);
    
    res.json({
      success: true,
      data: sales.map(formatSale),
      totalNetValue: Math.round(totalNetValue * 100) / 100, // Total líquido de todas as vendas (não apenas paginadas)
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
    const {
      items,
      totalValue,
      commissionValue,
      paymentMethod,
      discount,
      employeeId,
      employeeName,
      clientId,
      clientName,
      clientPhone,
      cardBrandGroup,
      installments,
    } = req.body;

    const installmentCount = paymentMethod === 'crédito' ? (installments || 1) : 1;
    const feePercentage = await getFeePercentageForUser(
      req.userId,
      paymentMethod,
      cardBrandGroup,
      installmentCount
    );
    const paymentFeeValue = round2((totalValue * feePercentage) / 100);
    const commission = commissionValue || 0;
    const calculatedNetValue = round2(Math.max(0, totalValue - commission - paymentFeeValue));
    const resolvedBrandGroup =
      paymentMethod === 'débito' || paymentMethod === 'crédito'
        ? cardBrandGroup || 'visa_master'
        : 'default';

    const sale = new Sale({
      userId: req.userId,
      items,
      totalValue,
      commissionValue: commission,
      netValue: calculatedNetValue,
      paymentMethod,
      paymentFeePercentage: round2(feePercentage),
      paymentFeeValue,
      cardBrandGroup: resolvedBrandGroup,
      installments: installmentCount,
      discount: discount || 0,
      employeeId: employeeId || undefined,
      employeeName: employeeName || undefined,
      clientId: clientId || undefined,
      clientName: clientName || undefined,
      clientPhone: clientPhone || undefined,
    });
    
    await sale.save();

    const linkedClient = await promoteLeadFromSale(req.userId, {
      clientId,
      clientPhone,
    });

    if (linkedClient) {
      if (!sale.clientId) {
        sale.clientId = linkedClient._id;
        if (!sale.clientName) sale.clientName = linkedClient.name;
        if (!sale.clientPhone) sale.clientPhone = linkedClient.phone;
        await sale.save();
      }

      const recommendationId = req.body.recommendationId || '';
      await logActivity({
        userId: req.userId,
        clientId: linkedClient._id,
        clientName: linkedClient.name,
        type: recommendationId ? 'recommendation_used' : 'note',
        content: recommendationId
          ? `Venda registrada usando recomendação ${recommendationId} · R$ ${calculatedNetValue}`
          : `Venda registrada · R$ ${calculatedNetValue}`,
      });

      await CommercialAction.updateMany(
        {
          userId: req.userId,
          clientId: linkedClient._id,
          status: 'pending',
        },
        {
          $set: {
            status: 'done',
            outcome: 'won',
            realizedRevenue: calculatedNetValue,
            completedAt: new Date(),
            feedback: 'accepted',
          },
        }
      );
    }
    
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

