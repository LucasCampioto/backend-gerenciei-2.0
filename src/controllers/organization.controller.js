const {
  listMembers,
  memberToPublic,
  findOrganizationById,
} = require('../services/organization.service');
const {
  createInvite,
  listInvites,
  revokeInvite,
  resendInvite,
  inviteToPublic,
} = require('../services/invite.service');
const { updateMember, removeMember } = require('../services/member.service');
const {
  MODULE_PERMISSIONS,
  PERMISSION_GROUPS,
  PRESETS,
  ALL_MODULE_IDS,
} = require('../constants/orgPermissions');
const { tenantFilter, tenantCreateFields } = require('../utils/tenantScope');
const {
  findEmployeeForUser,
  employeeCommissionPublic,
  upsertEmployeeForMember,
} = require('../services/memberEmployee.service');
const { getOrgSeatSummary } = require('../services/orgSeats.service');

async function getOrganization(req, res, next) {
  try {
    if (!req.orgId) {
      return res.json({
        success: true,
        data: {
          id: null,
          name: null,
          role: req.role || 'owner',
          permissionsCatalog: MODULE_PERMISSIONS,
          permissionGroups: PERMISSION_GROUPS,
          presets: PRESETS,
          seatLimit: 0,
          seatsUsed: 0,
          seatsRemaining: 0,
        },
      });
    }
    const org = await findOrganizationById(req.orgId);
    const seats = await getOrgSeatSummary(req.orgId);
    return res.json({
      success: true,
      data: {
        id: String(org._id),
        name: org.name,
        ownerUserId: String(org.ownerUserId),
        role: req.role,
        permissions: req.permissions,
        permissionsCatalog: MODULE_PERMISSIONS,
        permissionGroups: PERMISSION_GROUPS,
        presets: PRESETS,
        allModuleIds: ALL_MODULE_IDS,
        seatLimit: seats.seatLimit,
        seatsUsed: seats.seatsUsed,
        seatsMembers: seats.seatsMembers,
        seatsPending: seats.seatsPending,
        seatsRemaining: seats.seatsRemaining,
      },
    });
  } catch (error) {
    next(error);
  }
}

async function getMembers(req, res, next) {
  try {
    if (!req.orgId) {
      return res.json({ success: true, data: [] });
    }
    const members = await listMembers(req.orgId);
    const scope = tenantFilter(req);
    const data = await Promise.all(
      members.map(async (doc) => {
        const base = memberToPublic(doc);
        const employee = await findEmployeeForUser(scope, doc._id, doc.email);
        return {
          ...base,
          ...employeeCommissionPublic(employee),
        };
      }),
    );
    return res.json({
      success: true,
      data,
    });
  } catch (error) {
    next(error);
  }
}

async function patchMember(req, res, next) {
  try {
    const member = await updateMember({
      organizationId: req.orgId,
      actorUserId: req.userId,
      actorRole: req.role,
      memberId: req.params.memberId,
      patch: req.body || {},
    });

    const body = req.body || {};
    if (
      body.generalCommission !== undefined ||
      body.procedureCommissions !== undefined
    ) {
      await upsertEmployeeForMember({
        scopeFilter: tenantFilter(req),
        createFields: tenantCreateFields(req),
        linkedUserId: member.id,
        name: member.name,
        email: member.email,
        generalCommission: body.generalCommission,
        procedureCommissions: body.procedureCommissions,
      });
    }

    const employee = await findEmployeeForUser(
      tenantFilter(req),
      member.id,
      member.email,
    );
    return res.json({
      success: true,
      data: { ...member, ...employeeCommissionPublic(employee) },
    });
  } catch (error) {
    if (error.status) {
      return res.status(error.status).json({ success: false, error: error.message });
    }
    next(error);
  }
}

async function deleteMember(req, res, next) {
  try {
    const data = await removeMember({
      organizationId: req.orgId,
      actorUserId: req.userId,
      actorRole: req.role,
      memberId: req.params.memberId,
    });
    return res.json({
      success: true,
      data,
      message: 'Acesso excluído',
    });
  } catch (error) {
    if (error.status) {
      return res.status(error.status).json({ success: false, error: error.message });
    }
    next(error);
  }
}

async function getInvites(req, res, next) {
  try {
    if (!req.orgId) {
      return res.json({ success: true, data: [] });
    }
    const invites = await listInvites(req.orgId);
    return res.json({
      success: true,
      data: invites.map(inviteToPublic),
    });
  } catch (error) {
    next(error);
  }
}

async function postInvite(req, res, next) {
  try {
    if (!req.orgId) {
      return res.status(400).json({
        success: false,
        error: 'Organização não provisionada. Faça login novamente.',
      });
    }
    const { email, name, role, permissions, generalCommission, procedureCommissions } =
      req.body || {};
    const { invite } = await createInvite({
      organizationId: req.orgId,
      invitedByUserId: req.userId,
      inviterName: req.user?.name,
      orgName: req.orgName,
      email,
      name,
      role,
      permissions,
      generalCommission,
      procedureCommissions,
    });
    return res.status(201).json({
      success: true,
      data: inviteToPublic(invite),
      message: 'Convite enviado',
    });
  } catch (error) {
    if (error.status) {
      return res.status(error.status).json({ success: false, error: error.message });
    }
    next(error);
  }
}

async function postRevokeInvite(req, res, next) {
  try {
    const invite = await revokeInvite({
      organizationId: req.orgId,
      inviteId: req.params.inviteId,
    });
    return res.json({
      success: true,
      data: inviteToPublic(invite),
      message: 'Convite revogado',
    });
  } catch (error) {
    if (error.status) {
      return res.status(error.status).json({ success: false, error: error.message });
    }
    next(error);
  }
}

async function postResendInvite(req, res, next) {
  try {
    const invite = await resendInvite({
      organizationId: req.orgId,
      inviteId: req.params.inviteId,
      inviterName: req.user?.name,
      orgName: req.orgName,
    });
    return res.json({
      success: true,
      data: inviteToPublic(invite),
      message: 'Convite reenviado',
    });
  } catch (error) {
    if (error.status) {
      return res.status(error.status).json({ success: false, error: error.message });
    }
    next(error);
  }
}

module.exports = {
  getOrganization,
  getMembers,
  patchMember,
  deleteMember,
  getInvites,
  postInvite,
  postRevokeInvite,
  postResendInvite,
};
