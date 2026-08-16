const MEMBER_STATUSES = new Set(['active', 'disabled', 'invited']);

function httpError(message, status) {
  const err = new Error(message);
  err.status = status;
  return err;
}

/**
 * Regras de desativar/reativar colaborador (conta permanece; login bloqueia se disabled).
 * @returns {{ nextStatus: string, needsSeat: boolean }}
 */
function validateMemberStatusChange({
  actorUserId,
  actorRole,
  memberId,
  memberRole,
  currentStatus,
  nextStatus,
}) {
  if (!MEMBER_STATUSES.has(nextStatus)) {
    throw httpError('Status inválido', 400);
  }
  if (memberRole === 'owner') {
    throw httpError('Não é possível desativar o dono da organização', 400);
  }
  if (String(memberId) === String(actorUserId)) {
    throw httpError('Não é possível desativar a si mesmo', 400);
  }
  if (memberRole === 'admin' && actorRole !== 'owner') {
    throw httpError('Só o dono pode desativar ou reativar um administrador', 403);
  }
  const current = currentStatus || 'active';
  return {
    nextStatus,
    needsSeat: nextStatus === 'active' && current === 'disabled',
  };
}

module.exports = {
  MEMBER_STATUSES,
  validateMemberStatusChange,
};
