const User = require('../models/User');
const Organization = require('../models/Organization');
const OrganizationInvite = require('../models/OrganizationInvite');
const {
  resolvePlanTier,
  seatLimitForPlanTier,
} = require('./simulation/planEntitlements');

/**
 * Resolve limite de colaboradores (além do dono):
 * 1) Organization.seatLimit se número finito >= 0
 * 2) senão, pelo plano do owner
 * null = ilimitado
 *
 * O owner da conta NÃO consome assento.
 */
async function resolveOrgSeatLimit(organizationId) {
  if (!organizationId) return 0;
  const org = await Organization.findById(organizationId)
    .select('seatLimit ownerUserId')
    .lean();
  if (!org) return 0;

  if (org.seatLimit != null && Number.isFinite(Number(org.seatLimit)) && Number(org.seatLimit) >= 0) {
    return Number(org.seatLimit);
  }

  const owner = await User.findById(org.ownerUserId)
    .select('planTier accountType subscriptionBillingBypass stripeSubscriptionId _id')
    .lean();
  const tier = resolvePlanTier(owner);
  return seatLimitForPlanTier(tier);
}

/** Conta só colaboradores (exclui o owner). */
async function countOrgSeats(organizationId) {
  const org = await Organization.findById(organizationId).select('ownerUserId').lean();
  const ownerId = org?.ownerUserId;

  const memberFilter = {
    organizationId,
    status: { $ne: 'disabled' },
    role: { $ne: 'owner' },
  };
  if (ownerId) {
    memberFilter._id = { $ne: ownerId };
  }

  const [members, pending] = await Promise.all([
    User.countDocuments(memberFilter),
    OrganizationInvite.countDocuments({
      organizationId,
      status: 'pending',
    }),
  ]);
  return {
    members,
    pending,
    used: members + pending,
  };
}

/**
 * Garante que ainda há vaga para +1 colaborador (convite ou aceite).
 */
async function assertOrgHasSeatAvailable({ organizationId, forAccept = false }) {
  const limit = await resolveOrgSeatLimit(organizationId);
  if (limit == null) {
    const seats = await countOrgSeats(organizationId);
    return { limit: null, ...seats, remaining: null };
  }

  const seats = await countOrgSeats(organizationId);
  // Convite: used (colaboradores + pendentes) precisa ser < limit.
  // Aceite: só members (o pending vira member) — bloqueia se members >= limit.
  const blocked = forAccept ? seats.members >= limit : seats.used >= limit;

  if (blocked) {
    const err = new Error(
      limit === 0
        ? 'Seu plano não inclui colaboradores extras. Faça upgrade para convidar a equipe.'
        : `Limite de ${limit} colaborador${limit === 1 ? '' : 'es'} do plano atingido (o dono da conta não conta). Desative alguém ou faça upgrade.`,
    );
    err.status = 403;
    err.code = 'SEAT_LIMIT_REACHED';
    err.seatLimit = limit;
    err.seatsUsed = seats.used;
    throw err;
  }

  return {
    limit,
    ...seats,
    remaining: Math.max(0, limit - seats.used),
  };
}

async function getOrgSeatSummary(organizationId) {
  const limit = await resolveOrgSeatLimit(organizationId);
  const seats = await countOrgSeats(organizationId);
  return {
    seatLimit: limit,
    seatsUsed: seats.used,
    seatsMembers: seats.members,
    seatsPending: seats.pending,
    seatsRemaining: limit == null ? null : Math.max(0, limit - seats.used),
  };
}

module.exports = {
  resolveOrgSeatLimit,
  countOrgSeats,
  assertOrgHasSeatAvailable,
  getOrgSeatSummary,
  seatLimitForPlanTier,
};
