const User = require('../models/User');
const Employee = require('../models/Employee');
const PasswordResetToken = require('../models/PasswordResetToken');
const OrganizationInvite = require('../models/OrganizationInvite');
const {
  sanitizePermissions,
  ADMIN_DEFAULT_PERMISSIONS,
  OWNER_PERMISSIONS,
} = require('../constants/orgPermissions');
const { memberToPublic } = require('./organization.service');
const { assertOrgHasSeatAvailable } = require('./orgSeats.service');
const { validateMemberStatusChange } = require('./orgMemberStatus');

async function updateMember({ organizationId, actorUserId, actorRole, memberId, patch }) {
  const member = await User.findOne({ _id: memberId, organizationId });
  if (!member) {
    const err = new Error('Membro não encontrado');
    err.status = 404;
    throw err;
  }

  if (member.role === 'owner') {
    // Só o próprio owner altera nome/telefone; role/permissions/status bloqueados
    if (String(member._id) !== String(actorUserId)) {
      const err = new Error('Não é possível editar o dono por outro usuário');
      err.status = 403;
      throw err;
    }
    if (patch.name !== undefined) member.name = String(patch.name).trim();
    if (patch.phone !== undefined) member.phone = String(patch.phone).trim();
    if (patch.clinic !== undefined) member.clinic = String(patch.clinic).trim();
    await member.save();
    return memberToPublic(member);
  }

  if (actorRole !== 'owner' && actorRole !== 'admin') {
    const err = new Error('Sem permissão para editar membros');
    err.status = 403;
    throw err;
  }

  if (patch.role === 'owner') {
    const err = new Error('Não é possível promover a dono por esta rota');
    err.status = 400;
    throw err;
  }

  if (patch.name !== undefined) member.name = String(patch.name).trim();
  if (patch.phone !== undefined) member.phone = String(patch.phone).trim();
  if (patch.clinic !== undefined) member.clinic = String(patch.clinic).trim();

  if (patch.role !== undefined) {
    if (patch.role !== 'admin' && patch.role !== 'member') {
      const err = new Error('Papel inválido');
      err.status = 400;
      throw err;
    }
    if (member.role === 'admin' || patch.role === 'admin') {
      if (actorRole !== 'owner') {
        const err = new Error('Só o dono pode alterar o papel de administrador');
        err.status = 403;
        throw err;
      }
    }
    member.role = patch.role;
    if (patch.role === 'admin' && patch.permissions === undefined) {
      member.permissions = [...ADMIN_DEFAULT_PERMISSIONS];
    }
  }

  if (patch.permissions !== undefined) {
    if (member.role === 'admin') {
      member.permissions = sanitizePermissions(patch.permissions);
    } else {
      member.permissions = sanitizePermissions(patch.permissions);
    }
  }

  if (patch.status !== undefined) {
    const { nextStatus, needsSeat } = validateMemberStatusChange({
      actorUserId,
      actorRole,
      memberId: member._id,
      memberRole: member.role,
      currentStatus: member.status,
      nextStatus: patch.status,
    });
    if (needsSeat) {
      await assertOrgHasSeatAvailable({ organizationId, forAccept: false });
    }
    member.status = nextStatus;
  }

  await member.save();
  return memberToPublic(member);
}

/**
 * Remove colaborador da organização (exclui User de login).
 * Libera a vaga e permite novo convite com o mesmo e-mail.
 * Mantém Employee (comissões/histórico) apenas desvinculado.
 */
async function removeMember({ organizationId, actorUserId, actorRole, memberId }) {
  if (actorRole !== 'owner' && actorRole !== 'admin') {
    const err = new Error('Sem permissão para excluir membros');
    err.status = 403;
    throw err;
  }

  const member = await User.findOne({ _id: memberId, organizationId });
  if (!member) {
    const err = new Error('Membro não encontrado');
    err.status = 404;
    throw err;
  }

  if (member.role === 'owner') {
    const err = new Error('Não é possível excluir o dono da organização');
    err.status = 400;
    throw err;
  }

  if (String(member._id) === String(actorUserId)) {
    const err = new Error('Não é possível excluir a si mesmo');
    err.status = 400;
    throw err;
  }

  if (member.role === 'admin' && actorRole !== 'owner') {
    const err = new Error('Só o dono pode excluir um administrador');
    err.status = 403;
    throw err;
  }

  const emailNorm = (member.email || '').toLowerCase().trim();

  await Employee.updateMany(
    { organizationId, linkedUserId: member._id },
    { $set: { linkedUserId: null } },
  );

  await PasswordResetToken.deleteMany({ userId: member._id });

  if (emailNorm) {
    await OrganizationInvite.updateMany(
      { organizationId, email: emailNorm, status: 'pending' },
      { $set: { status: 'revoked' } },
    );
  }

  await User.deleteOne({ _id: member._id, organizationId });

  return { id: String(memberId), removed: true };
}

module.exports = {
  updateMember,
  removeMember,
  OWNER_PERMISSIONS,
};
