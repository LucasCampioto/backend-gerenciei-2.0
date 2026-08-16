const Employee = require('../models/Employee');
const mongoose = require('mongoose');
const { andFilters } = require('../utils/tenantScope');

function normalizeCommissionList(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const row of list) {
    const procedureId = row?.procedureId;
    if (!procedureId || !mongoose.Types.ObjectId.isValid(procedureId)) continue;
    const percentage = Number(row.percentage);
    if (!Number.isFinite(percentage) || percentage < 0 || percentage > 100) continue;
    out.push({
      procedureId: new mongoose.Types.ObjectId(procedureId),
      percentage,
    });
  }
  return out;
}

/**
 * Cria ou atualiza o Employee (comissões) ligado a um User da org.
 * scopeFilter = tenantFilter(req); createFields = tenantCreateFields(req)
 */
async function upsertEmployeeForMember({
  scopeFilter,
  createFields,
  linkedUserId,
  name,
  email,
  generalCommission,
  procedureCommissions,
}) {
  const actorId = new mongoose.Types.ObjectId(linkedUserId);
  const emailNorm = (email || '').toLowerCase().trim();

  let employee = await Employee.findOne(andFilters(scopeFilter, { linkedUserId: actorId }));

  if (!employee && emailNorm) {
    employee = await Employee.findOne(andFilters(scopeFilter, { email: emailNorm }));
  }

  const commissions =
    procedureCommissions !== undefined
      ? normalizeCommissionList(procedureCommissions)
      : undefined;
  const general =
    generalCommission !== undefined && Number.isFinite(Number(generalCommission))
      ? Math.min(100, Math.max(0, Number(generalCommission)))
      : undefined;

  if (!employee) {
    employee = new Employee({
      ...createFields,
      linkedUserId: actorId,
      name: name || emailNorm || 'Colaborador',
      email: emailNorm || undefined,
      generalCommission: general ?? 0,
      procedureCommissions: commissions || [],
    });
    await employee.save();
    return employee;
  }

  employee.linkedUserId = actorId;
  if (name) employee.name = name;
  if (emailNorm) employee.email = emailNorm;
  if (general !== undefined) employee.generalCommission = general;
  if (commissions !== undefined) employee.procedureCommissions = commissions;
  await employee.save();
  return employee;
}

function employeeCommissionPublic(employee) {
  if (!employee) {
    return {
      employeeId: null,
      generalCommission: 0,
      procedureCommissions: [],
    };
  }
  const obj = employee.toObject ? employee.toObject() : employee;
  return {
    employeeId: String(obj._id),
    generalCommission: obj.generalCommission ?? 0,
    procedureCommissions: (obj.procedureCommissions || []).map((pc) => ({
      procedureId: String(pc.procedureId),
      percentage: pc.percentage,
    })),
  };
}

async function findEmployeeForUser(scopeFilter, linkedUserId, email) {
  const actorId = new mongoose.Types.ObjectId(linkedUserId);
  let employee = await Employee.findOne(andFilters(scopeFilter, { linkedUserId: actorId }));
  if (!employee && email) {
    employee = await Employee.findOne(
      andFilters(scopeFilter, { email: String(email).toLowerCase().trim() }),
    );
  }
  return employee;
}

module.exports = {
  upsertEmployeeForMember,
  employeeCommissionPublic,
  findEmployeeForUser,
  normalizeCommissionList,
};
