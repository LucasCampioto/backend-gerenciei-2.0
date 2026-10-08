const Sale = require('../models/Sale');
const Coupon = require('../models/Coupon');
const Employee = require('../models/Employee');
const Client = require('../models/Client');
const mongoose = require('mongoose');
const { getFeePercentageForUser, round2 } = require('./paymentFee.controller');
const { logActivity } = require('../services/clientActivity.service');
const CommercialAction = require('../models/CommercialAction');
const { tenantFilter, tenantCreateFields, scopeUserId, actorScopedTenantFilter, actorScopedDocFilter, andFilters, isOrgAdminRequest, toObjectId } = require('../utils/tenantScope');
const User = require('../models/User');
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

function formatSale(sale, creatorNameById = null) {
  const obj = sale.toObject ? sale.toObject() : sale;
  const createdByUserId = obj.createdByUserId ? obj.createdByUserId.toString() : null;
  return {
    id: (obj._id ?? sale._id).toString(),
    items: (obj.items || []).map(item => ({
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
    couponId: obj.couponId ? String(obj.couponId) : null,
    couponCode: obj.couponCode || '',
    employeeId: obj.employeeId ? obj.employeeId.toString() : obj.employeeId,
    employeeName: obj.employeeName,
    clientId: obj.clientId ? obj.clientId.toString() : obj.clientId,
    clientName: obj.clientName,
    clientPhone: obj.clientPhone,
    createdByUserId,
    createdByName: createdByUserId && creatorNameById
      ? creatorNameById.get(createdByUserId) || null
      : null,
    createdAt: obj.createdAt
  };
}

async function loadCreatorNames(sales) {
  const ids = [
    ...new Set(
      sales
        .map((s) => (s.createdByUserId ? String(s.createdByUserId) : null))
        .filter(Boolean),
    ),
  ];
  if (ids.length === 0) return new Map();
  const users = await User.find({ _id: { $in: ids } })
    .select('name')
    .lean();
  return new Map(users.map((u) => [String(u._id), u.name]));
}

async function getAllSales(req, res, next) {
  try {
    // Garante: lead com venda → cliente (só admin/owner sincroniza org inteira)
    if (isOrgAdminRequest(req)) {
      await syncLeadsWithSales(scopeUserId(req)).catch(() => {});
    }

    const { startDate, endDate, employeeId, clientId, createdByUserId, page = 1, limit = 10 } = req.query;

    const clauses = [actorScopedTenantFilter(req)];

    if (startDate || endDate) {
      const createdAt = {};
      if (startDate) createdAt.$gte = parseClinicDayStart(startDate);
      if (endDate) createdAt.$lte = parseClinicDayEnd(endDate);
      clauses.push({ createdAt });
    }

    if (employeeId && mongoose.Types.ObjectId.isValid(employeeId)) {
      clauses.push({ employeeId });
    }

    if (clientId && mongoose.Types.ObjectId.isValid(clientId)) {
      clauses.push({ clientId });
    }

    // Admin pode filtrar por quem registrou; membro já está restrito ao próprio
    if (
      isOrgAdminRequest(req) &&
      createdByUserId &&
      mongoose.Types.ObjectId.isValid(createdByUserId)
    ) {
      clauses.push({ createdByUserId: new mongoose.Types.ObjectId(createdByUserId) });
    }

    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
    if (search) {
      const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(escaped, 'i');
      clauses.push({
        $or: [
          { clientName: regex },
          { clientPhone: regex },
          { 'items.procedureName': regex },
        ],
      });
    }

    const query = andFilters(...clauses);

    const pageNum = parseInt(page, 10) || 1;
    const limitNum = parseInt(limit, 10) || 10;
    const skip = (pageNum - 1) * limitNum;

    const total = await Sale.countDocuments(query);
    const sales = await Sale.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum);

    const totalPages = Math.ceil(total / limitNum);
    const hasNextPage = pageNum < totalPages;
    const hasPrevPage = pageNum > 1;

    // Resumo por colaborador — mesmo escopo de visibilidade
    const summaryClauses = [
      actorScopedTenantFilter(req),
      { employeeId: { $exists: true, $ne: null } },
    ];
    if (startDate || endDate) {
      const createdAt = {};
      if (startDate) createdAt.$gte = parseClinicDayStart(startDate);
      if (endDate) createdAt.$lte = parseClinicDayEnd(endDate);
      summaryClauses.push({ createdAt });
    }
    if (employeeId && mongoose.Types.ObjectId.isValid(employeeId)) {
      summaryClauses.push({ employeeId: new mongoose.Types.ObjectId(employeeId) });
    }
    if (search) {
      const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(escaped, 'i');
      summaryClauses.push({
        $or: [
          { clientName: regex },
          { clientPhone: regex },
          { 'items.procedureName': regex },
        ],
      });
    }
    if (
      isOrgAdminRequest(req) &&
      createdByUserId &&
      mongoose.Types.ObjectId.isValid(createdByUserId)
    ) {
      summaryClauses.push({ createdByUserId: new mongoose.Types.ObjectId(createdByUserId) });
    }

    const allSales = await Sale.find(andFilters(...summaryClauses));
    const creatorNames = await loadCreatorNames([...sales, ...allSales]);

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

    const summaryByEmployee = await Promise.all(
      Object.values(salesByEmployee).map(async (employeeData) => {
        try {
          const employee = await Employee.findOne({
            _id: employeeData.employeeId, ...tenantFilter(req)
          });

          const salesCount = employeeData.sales.length;
          const totalSalesValue = employeeData.totalSalesValue;
          const totalCommission = employeeData.totalCommission;

          const averageCommissionPercentage = totalSalesValue > 0
            ? (totalCommission / totalSalesValue) * 100
            : 0;

          return {
            employeeId: employeeData.employeeId,
            employeeName: employee?.name || employeeData.employeeName || 'Colaborador não encontrado',
            totalSalesValue: Math.round(totalSalesValue * 100) / 100,
            salesCount,
            totalCommission: Math.round(totalCommission * 100) / 100,
            averageCommissionPercentage: Math.round(averageCommissionPercentage * 100) / 100
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

    // Resumo por usuário de login (quem registrou) — útil para admin
    const salesByCreator = {};
    allSales.forEach((sale) => {
      const uid = sale.createdByUserId ? String(sale.createdByUserId) : '_unknown';
      if (!salesByCreator[uid]) {
        salesByCreator[uid] = {
          createdByUserId: uid === '_unknown' ? null : uid,
          createdByName: uid === '_unknown' ? 'Sem registro' : creatorNames.get(uid) || 'Usuário',
          salesCount: 0,
          totalSalesValue: 0,
        };
      }
      salesByCreator[uid].salesCount += 1;
      salesByCreator[uid].totalSalesValue += sale.totalValue || 0;
    });
    const summaryByCreator = Object.values(salesByCreator).map((row) => ({
      ...row,
      totalSalesValue: Math.round(row.totalSalesValue * 100) / 100,
    }));

    summaryByEmployee.sort((a, b) => b.totalSalesValue - a.totalSalesValue);
    const totalNetValue = allSales.reduce((sum, s) => sum + (s.netValue || 0), 0);

    res.json({
      success: true,
      data: sales.map((s) => formatSale(s, creatorNames)),
      summaryByEmployee,
      summaryByCreator,
      visibility: isOrgAdminRequest(req) ? 'organization' : 'own',
      totalNetValue: Math.round(totalNetValue * 100) / 100,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages,
        hasNextPage,
        hasPrevPage
      }
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
      couponId,
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
      scopeUserId(req),
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

    let linkedCoupon = null;
    if (couponId) {
      if (!mongoose.Types.ObjectId.isValid(couponId)) {
        return res.status(400).json({ success: false, error: 'Cupom inválido' });
      }
      linkedCoupon = await Coupon.findOne({
        _id: couponId,
        userId: scopeUserId(req),
        active: true,
      });
      if (!linkedCoupon) {
        return res.status(400).json({ success: false, error: 'Cupom não encontrado' });
      }
    }

    const sale = new Sale({
      ...tenantCreateFields(req),
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
      couponId: linkedCoupon ? linkedCoupon._id : null,
      couponCode: linkedCoupon ? linkedCoupon.code : '',
      employeeId: employeeId || undefined,
      employeeName: employeeName || undefined,
      clientId: clientId || undefined,
      clientName: clientName || undefined,
      clientPhone: clientPhone || undefined,
    });
    
    await sale.save();

    const linkedClient = await promoteLeadFromSale(scopeUserId(req), {
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
    }

    if (linkedClient) {
      const recommendationId = req.body.recommendationId || '';
      await logActivity({
        ...tenantCreateFields(req),
        clientId: linkedClient._id,
        clientName: linkedClient.name,
        type: recommendationId ? 'recommendation_used' : 'note',
        content: recommendationId
          ? `Venda registrada usando recomendação ${recommendationId} · R$ ${calculatedNetValue}`
          : `Venda registrada · R$ ${calculatedNetValue}`,
      });

      await CommercialAction.updateMany(
        {
          ...tenantCreateFields(req),
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
    
    const sale = await Sale.findOneAndDelete(actorScopedDocFilter(req, id));
    
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
    
    const sales = await Sale.find(
      andFilters(actorScopedTenantFilter(req), { employeeId }),
    ).sort({ createdAt: -1 });

    const creatorNames = await loadCreatorNames(sales);
    
    res.json({
      success: true,
      data: sales.map((s) => formatSale(s, creatorNames))
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

    const match = andFilters(actorScopedTenantFilter(req), {
      employeeId: new mongoose.Types.ObjectId(employeeId),
    });
    
    const result = await Sale.aggregate([
      { $match: match },
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

