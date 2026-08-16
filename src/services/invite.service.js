const { createHash, randomBytes } = require('crypto');
const User = require('../models/User');
const OrganizationInvite = require('../models/OrganizationInvite');
const Organization = require('../models/Organization');
const {
  sanitizePermissions,
  ADMIN_DEFAULT_PERMISSIONS,
  isOrgAdminRole,
} = require('../constants/orgPermissions');
const { sendMemberInviteEmail } = require('./simulation/email');
const { assertOrgHasSeatAvailable } = require('./orgSeats.service');

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function hashToken(raw) {
  return createHash('sha256').update(String(raw)).digest('hex');
}

function inviteFrontUrl(rawToken) {
  const base =
    (process.env.FRONTEND_INVITE_URL || '').trim() ||
    `${String(process.env.FRONTEND_URL || process.env.CORS_ORIGIN || 'http://localhost:8080').replace(/\/$/, '')}/convite`;
  const sep = base.includes('?') ? '&' : '?';
  return `${base.replace(/\/$/, '')}${sep}token=${encodeURIComponent(rawToken)}`;
}

function inviteToPublic(doc) {
  return {
    id: String(doc._id),
    email: doc.email,
    name: doc.name,
    role: doc.role,
    permissions: doc.permissions || [],
    generalCommission: doc.generalCommission ?? 0,
    procedureCommissions: (doc.procedureCommissions || []).map((pc) => ({
      procedureId: String(pc.procedureId),
      percentage: pc.percentage,
    })),
    status: doc.status,
    expiresAt: doc.expiresAt,
    createdAt: doc.createdAt,
  };
}

async function createInvite({
  organizationId,
  invitedByUserId,
  inviterName,
  orgName,
  email,
  name,
  role = 'member',
  permissions = [],
  generalCommission = 0,
  procedureCommissions = [],
}) {
  const e = String(email || '').toLowerCase().trim();
  const n = String(name || '').trim();
  if (!e || !n) {
    const err = new Error('Nome e e-mail são obrigatórios');
    err.status = 400;
    throw err;
  }

  if (role === 'owner') {
    const err = new Error('Não é possível convidar como owner');
    err.status = 400;
    throw err;
  }

  const existingUser = await User.findOne({ email: e }).select('_id organizationId').lean();
  if (existingUser) {
    if (
      existingUser.organizationId &&
      String(existingUser.organizationId) === String(organizationId)
    ) {
      const err = new Error('Este e-mail já é membro da organização');
      err.status = 409;
      throw err;
    }
    const err = new Error('Este e-mail já possui conta em outra organização');
    err.status = 409;
    throw err;
  }

  await assertOrgHasSeatAvailable({ organizationId, forAccept: false });

  await OrganizationInvite.updateMany(
    { organizationId, email: e, status: 'pending' },
    { $set: { status: 'revoked' } },
  );

  const rawToken = randomBytes(32).toString('hex');
  const tokenHash = hashToken(rawToken);
  const perms =
    role === 'admin'
      ? sanitizePermissions(
          permissions.length ? permissions : [...ADMIN_DEFAULT_PERMISSIONS],
        )
      : sanitizePermissions(permissions);

  const invite = await OrganizationInvite.create({
    organizationId,
    email: e,
    name: n,
    role: role === 'admin' ? 'admin' : 'member',
    permissions: perms,
    generalCommission: Number.isFinite(Number(generalCommission))
      ? Math.min(100, Math.max(0, Number(generalCommission)))
      : 0,
    procedureCommissions: Array.isArray(procedureCommissions)
      ? procedureCommissions
          .filter((pc) => pc?.procedureId && Number.isFinite(Number(pc.percentage)))
          .map((pc) => ({
            procedureId: pc.procedureId,
            percentage: Math.min(100, Math.max(0, Number(pc.percentage))),
          }))
      : [],
    tokenHash,
    expiresAt: new Date(Date.now() + INVITE_TTL_MS),
    status: 'pending',
    invitedByUserId,
  });

  const inviteUrl = inviteFrontUrl(rawToken);
  await sendMemberInviteEmail({
    to: e,
    inviteUrl,
    orgName: orgName || 'Gerenciei',
    inviterName: inviterName || 'Administrador',
    modulesLabel: perms.length ? perms.join(', ') : 'conforme definido pelo admin',
  });

  return { invite, inviteUrl };
}

async function listInvites(organizationId) {
  return OrganizationInvite.find({
    organizationId,
    status: { $in: ['pending', 'accepted', 'revoked', 'expired'] },
  })
    .sort({ createdAt: -1 })
    .limit(100)
    .lean();
}

async function revokeInvite({ organizationId, inviteId }) {
  const invite = await OrganizationInvite.findOne({ _id: inviteId, organizationId });
  if (!invite) {
    const err = new Error('Convite não encontrado');
    err.status = 404;
    throw err;
  }
  if (invite.status !== 'pending') {
    const err = new Error('Só é possível revogar convites pendentes');
    err.status = 400;
    throw err;
  }
  invite.status = 'revoked';
  await invite.save();
  return invite;
}

async function resendInvite({ organizationId, inviteId, inviterName, orgName }) {
  const invite = await OrganizationInvite.findOne({ _id: inviteId, organizationId });
  if (!invite || invite.status !== 'pending') {
    const err = new Error('Convite pendente não encontrado');
    err.status = 404;
    throw err;
  }
  if (invite.expiresAt.getTime() < Date.now()) {
    invite.status = 'expired';
    await invite.save();
    const err = new Error('Convite expirado — crie um novo');
    err.status = 400;
    throw err;
  }

  const rawToken = randomBytes(32).toString('hex');
  invite.tokenHash = hashToken(rawToken);
  invite.expiresAt = new Date(Date.now() + INVITE_TTL_MS);
  await invite.save();

  const inviteUrl = inviteFrontUrl(rawToken);
  await sendMemberInviteEmail({
    to: invite.email,
    inviteUrl,
    orgName: orgName || 'Gerenciei',
    inviterName: inviterName || 'Administrador',
    modulesLabel: (invite.permissions || []).join(', ') || 'conforme definido pelo admin',
  });

  return invite;
}

/**
 * Aceita convite: cria User na org com senha definida (não envia senha por e-mail).
 */
async function acceptInvite({ token, password }) {
  const raw = String(token || '').trim();
  const pwd = String(password || '');
  if (!raw || pwd.length < 8) {
    const err = new Error('Token e senha (mín. 8 caracteres) são obrigatórios');
    err.status = 400;
    throw err;
  }

  const tokenHash = hashToken(raw);
  const invite = await OrganizationInvite.findOne({ tokenHash, status: 'pending' });
  if (!invite || invite.expiresAt.getTime() < Date.now()) {
    if (invite && invite.status === 'pending') {
      invite.status = 'expired';
      await invite.save();
    }
    const err = new Error('Link inválido ou expirado');
    err.status = 400;
    throw err;
  }

  const org = await Organization.findById(invite.organizationId);
  if (!org) {
    const err = new Error('Organização não encontrada');
    err.status = 404;
    throw err;
  }

  await assertOrgHasSeatAvailable({
    organizationId: invite.organizationId,
    forAccept: true,
  });

  const existing = await User.findOne({ email: invite.email });
  if (existing) {
    const err = new Error('Este e-mail já possui conta');
    err.status = 409;
    throw err;
  }

  const role = invite.role === 'admin' ? 'admin' : 'member';
  const user = await User.create({
    email: invite.email,
    password: pwd,
    name: invite.name,
    clinic: '',
    phone: '',
    notifEmail: true,
    notifSms: false,
    firstAccess: false,
    organizationId: invite.organizationId,
    role,
    permissions: sanitizePermissions(invite.permissions),
    status: 'active',
    mustSetPassword: false,
  });

  invite.status = 'accepted';
  invite.acceptedUserId = user._id;
  await invite.save();

  try {
    const {
      upsertEmployeeForMember,
    } = require('./memberEmployee.service');
    const orgOwnerId = org.ownerUserId;
    await upsertEmployeeForMember({
      scopeFilter: {
        $or: [
          { organizationId: invite.organizationId },
          {
            userId: orgOwnerId,
            $or: [{ organizationId: null }, { organizationId: { $exists: false } }],
          },
        ],
      },
      createFields: {
        userId: orgOwnerId,
        organizationId: invite.organizationId,
        createdByUserId: user._id,
      },
      linkedUserId: user._id,
      name: user.name,
      email: user.email,
      generalCommission: invite.generalCommission ?? 0,
      procedureCommissions: invite.procedureCommissions || [],
    });
  } catch (err) {
    console.warn('[invite] sync employee commissions:', err.message);
  }

  return { user, organization: org };
}

async function getInvitePreview(token) {
  const raw = String(token || '').trim();
  if (!raw) return null;
  const invite = await OrganizationInvite.findOne({
    tokenHash: hashToken(raw),
    status: 'pending',
  }).lean();
  if (!invite || invite.expiresAt.getTime() < Date.now()) return null;
  const org = await Organization.findById(invite.organizationId).select('name').lean();
  return {
    email: invite.email,
    name: invite.name,
    orgName: org?.name || 'Gerenciei',
    role: invite.role,
    expiresAt: invite.expiresAt,
  };
}

module.exports = {
  createInvite,
  listInvites,
  revokeInvite,
  resendInvite,
  acceptInvite,
  getInvitePreview,
  inviteToPublic,
  hashToken,
  isOrgAdminRole,
};
