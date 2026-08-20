const { randomBytes } = require('crypto');
const User = require('../../models/User');
const { applyQuotaPeriodResetIfNeeded } = require('./simulationQuotas');
const { isSubscriptionBypassUser } = require('./subscriptionBypass');
const {
  resolveOrgBillingUser,
  overlayPublicBillingFields,
} = require('../orgBilling.service');

/**
 * Adaptação de luni users.js para o User Gerenciei.
 * Usa o campo `password` (hash via pre-save do model), não passwordHash.
 * Campos de billing/quota/terms serão persistidos quando o User for estendido.
 */
function userToPublic(doc) {
  const out = {
    name: doc.name,
    email: doc.email,
    clinic: doc.clinic,
    phone: doc.phone || '',
    notifEmail: doc.notifEmail !== false,
    notifSms: doc.notifSms === true,
    firstAccess: doc.firstAccess === true,
    simulationCreditsRemaining: doc.simulationCreditsRemaining ?? 0,
    simulationMonthlyQuota: doc.simulationMonthlyQuota ?? 0,
    previewCreditsRemaining: doc.previewCreditsRemaining ?? 0,
    previewMonthlyQuota: doc.previewMonthlyQuota ?? 0,
    accountType: doc.accountType === 'partner_test' ? 'partner_test' : 'official',
  };
  if (doc._id) out.id = String(doc._id);
  if (isSubscriptionBypassUser(doc)) {
    out.subscriptionBillingBypass = true;
    out.subscriptionStatus = 'active';
  } else if (doc.subscriptionStatus) {
    out.subscriptionStatus = doc.subscriptionStatus;
  }
  if (doc.trialEndsAt) out.trialEndsAt = doc.trialEndsAt.toISOString();
  if (doc.currentPeriodEnd) out.currentPeriodEnd = doc.currentPeriodEnd.toISOString();
  if (doc.cancelAtPeriodEnd === true && !isSubscriptionBypassUser(doc)) {
    out.cancelAtPeriodEnd = true;
  }
  if (doc.partnerTestExpiresAt) out.partnerTestExpiresAt = doc.partnerTestExpiresAt.toISOString();
  if (doc.termsAcceptedAt) out.termsAcceptedAt = doc.termsAcceptedAt.toISOString();
  if (doc.privacyAcceptedAt) out.privacyAcceptedAt = doc.privacyAcceptedAt.toISOString();
  if (doc.termsVersion) out.termsVersion = doc.termsVersion;
  if (doc.patientDataResponsibilityAckAt) {
    out.patientDataResponsibilityAckAt = doc.patientDataResponsibilityAckAt.toISOString();
  }
  if (doc.planTier) out.planTier = String(doc.planTier);
  if (doc.organizationId) out.organizationId = String(doc.organizationId);
  if (doc.role) out.role = doc.role;
  if (Array.isArray(doc.permissions)) out.permissions = doc.permissions;
  if (doc.status) out.status = doc.status;
  if (doc.mustSetPassword === true) out.mustSetPassword = true;
  return out;
}

async function userToPublicWithOrgBilling(doc) {
  const out = userToPublic(doc);
  if (isSubscriptionBypassUser(doc)) return out;
  const billingUser = await resolveOrgBillingUser(doc);
  return overlayPublicBillingFields(out, billingUser);
}

const PARTNER_PLAN_TIERS = new Set(['gestao', 'profissional']);

/**
 * @param {unknown} planTier
 * @param {{ required?: boolean }} [opts]
 * @returns {{ tier: 'gestao' | 'profissional' } | { error: string }}
 */
function normalizePartnerPlanTier(planTier, opts = {}) {
  const required = opts.required === true;
  const raw = planTier != null ? String(planTier).trim().toLowerCase() : '';
  if (!raw) {
    if (required) return { error: 'planTier é obrigatório (gestao ou profissional)' };
    return { tier: 'profissional' };
  }
  if (!PARTNER_PLAN_TIERS.has(raw)) {
    return { error: 'planTier inválido (use gestao ou profissional)' };
  }
  return { tier: /** @type {'gestao' | 'profissional'} */ (raw) };
}

function resolvePartnerTestExpiresAt({ partnerTestExpiresAt, partnerTestDurationDays }) {
  const raw = partnerTestExpiresAt != null ? String(partnerTestExpiresAt).trim() : '';
  if (raw) {
    const d = new Date(raw);
    if (!Number.isNaN(d.getTime())) return d;
  }
  const days = Number(partnerTestDurationDays);
  if (Number.isFinite(days) && days > 0) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + Math.floor(days));
    return d;
  }
  return null;
}

// Same as findUserById but applies a lazy monthly quota reset before returning.
async function findUserByIdWithQuotaReset(userId) {
  let user = await User.findById(userId);
  if (!user) return null;
  user = await applyQuotaPeriodResetIfNeeded(user);
  return user;
}

async function findUserByEmail(email) {
  const e = String(email || '').toLowerCase().trim();
  if (!e) return null;
  return User.findOne({ email: e });
}

async function createUser({ name, clinic, email, password }) {
  return createUserWithPassword({ name, clinic, email, password, firstAccess: false });
}

/**
 * Cria usuário com senha em texto plano — o User Gerenciei faz hash no pre('save').
 * Sempre provisiona Organization + role owner (conta nova = org nova).
 */
async function createUserWithPassword({ name, clinic, email, password, firstAccess = true }) {
  const e = String(email).toLowerCase().trim();
  const user = await User.create({
    email: e,
    password: String(password),
    name: String(name).trim(),
    clinic: String(clinic || '').trim(),
    phone: '',
    notifEmail: true,
    notifSms: false,
    firstAccess: firstAccess === true,
  });
  const { attachOrgAfterUserCreate } = require('../organization.service');
  const { user: withOrg } = await attachOrgAfterUserCreate(user, {
    name: clinic || name,
  });
  return withOrg;
}

async function verifyPassword(user, password) {
  if (typeof user.comparePassword === 'function') {
    return user.comparePassword(String(password));
  }
  return false;
}

/** Só estes campos vêm de PATCH /me; cota, Stripe e assinatura são rejeitados na rota. */
async function updateUserById(userId, patch) {
  const allowed = ['name', 'email', 'clinic', 'phone', 'notifEmail', 'notifSms'];
  const update = {};
  for (const k of allowed) {
    if (patch[k] !== undefined) update[k] = patch[k];
  }
  if (update.email) update.email = String(update.email).toLowerCase().trim();
  const user = await User.findByIdAndUpdate(userId, { $set: update }, { new: true });
  return user;
}

async function updateUserPassword(userId, newPassword, { firstAccess = false } = {}) {
  const user = await User.findById(userId);
  if (!user) return null;
  user.password = String(newPassword);
  if (user.firstAccess !== undefined || firstAccess === true) {
    user.firstAccess = firstAccess === true;
  }
  await user.save();
  return user;
}

async function findUserById(userId) {
  return User.findById(userId);
}

async function findUserByStripeCustomerId(customerId) {
  const id = String(customerId || '').trim();
  if (!id) return null;
  return User.findOne({ stripeCustomerId: id });
}

async function findUserByStripeSubscriptionId(subscriptionId) {
  const id = String(subscriptionId || '').trim();
  if (!id) return null;
  return User.findOne({ stripeSubscriptionId: id });
}

async function updateUserStripeFields(userId, fields) {
  const set = {};
  if (fields.stripeCustomerId !== undefined) set.stripeCustomerId = String(fields.stripeCustomerId || '').trim();
  if (fields.stripeSubscriptionId !== undefined) set.stripeSubscriptionId = String(fields.stripeSubscriptionId || '').trim();
  if (fields.subscriptionStatus !== undefined) set.subscriptionStatus = String(fields.subscriptionStatus || '').trim();
  if (fields.trialEndsAt !== undefined) set.trialEndsAt = fields.trialEndsAt;
  if (fields.currentPeriodEnd !== undefined) set.currentPeriodEnd = fields.currentPeriodEnd;
  if (fields.cancelAtPeriodEnd !== undefined) set.cancelAtPeriodEnd = fields.cancelAtPeriodEnd === true;
  if (fields.accountType !== undefined) set.accountType = fields.accountType;
  if (fields.partnerTestExpiresAt !== undefined) set.partnerTestExpiresAt = fields.partnerTestExpiresAt;
  if (fields.termsAcceptedAt !== undefined) set.termsAcceptedAt = fields.termsAcceptedAt;
  if (fields.privacyAcceptedAt !== undefined) set.privacyAcceptedAt = fields.privacyAcceptedAt;
  if (fields.termsVersion !== undefined) set.termsVersion = String(fields.termsVersion || '').trim();
  if (fields.patientDataResponsibilityAckAt !== undefined) {
    set.patientDataResponsibilityAckAt = fields.patientDataResponsibilityAckAt;
  }
  if (Object.keys(set).length === 0) return User.findById(userId);
  return User.findByIdAndUpdate(userId, { $set: set }, { new: true });
}

async function acceptUserTerms(userId, { termsVersion, acceptTerms, acceptPrivacy, acceptPatientResponsibility }) {
  if (!acceptTerms || !acceptPrivacy || !acceptPatientResponsibility) {
    return { error: 'É necessário aceitar todos os termos e declarações.', status: 400 };
  }
  const now = new Date();
  const user = await User.findByIdAndUpdate(
    userId,
    {
      $set: {
        termsAcceptedAt: now,
        privacyAcceptedAt: now,
        termsVersion: String(termsVersion || '').trim(),
        patientDataResponsibilityAckAt: now,
      },
    },
    { new: true },
  );
  if (!user) return { error: 'Usuário não encontrado', status: 404 };
  return { user };
}

/**
 * Conta parceiro: cota fixa (sem reposição mensal), sem Stripe até upgrade.
 * Senha em texto plano — hash via pre-save do User Gerenciei.
 * @param {{ planTier?: string, planTierRequired?: boolean }} opts
 * @returns {Promise<{ user: import('mongoose').Document, plainPassword: string | null } | { error: string, status: number }>}
 */
async function createPartnerTestUser({
  name,
  clinic,
  email,
  password,
  simulationCredits = 10,
  previewCredits = 5,
  planTier,
  planTierRequired = false,
  partnerTestExpiresAt,
  partnerTestDurationDays,
}) {
  const tierResult = normalizePartnerPlanTier(planTier, { required: planTierRequired });
  if (tierResult.error) return { error: tierResult.error, status: 400 };

  const raw = Number(simulationCredits);
  const credits = Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) : 10;
  const rawPreview = Number(previewCredits);
  const previewPts = Number.isFinite(rawPreview) && rawPreview >= 0 ? Math.floor(rawPreview) : 5;
  const pwd =
    password != null && String(password).length > 0
      ? String(password)
      : randomBytes(18).toString('base64url');
  const e = String(email).toLowerCase().trim();
  const expiresAt = resolvePartnerTestExpiresAt({ partnerTestExpiresAt, partnerTestDurationDays });
  const user = await User.create({
    email: e,
    password: pwd,
    name: String(name).trim(),
    clinic: String(clinic || '').trim(),
    phone: '',
    notifEmail: true,
    notifSms: false,
    firstAccess: true,
    accountType: 'partner_test',
    planTier: tierResult.tier,
    simulationMonthlyQuota: 0,
    simulationCreditsRemaining: credits,
    simulationQuotaPeriodKey: '',
    previewMonthlyQuota: previewPts,
    previewCreditsRemaining: previewPts,
    previewQuotaPeriodKey: '',
    partnerTestExpiresAt: expiresAt,
  });
  const { attachOrgAfterUserCreate } = require('../organization.service');
  const { user: withOrg } = await attachOrgAfterUserCreate(user, {
    name: clinic || name,
  });
  return { user: withOrg, plainPassword: password != null && String(password).length > 0 ? null : pwd };
}

/**
 * Atualiza conta parceiro (não altera email nem senha).
 * @returns {Promise<{ user: import('mongoose').Document } | { error: string, status: number }>}
 */
async function updatePartnerTestUser(userId, patch = {}) {
  const id = String(userId || '').trim();
  if (!id) return { error: 'id inválido', status: 400 };

  const user = await User.findById(id);
  if (!user) return { error: 'Usuário não encontrado', status: 404 };
  if (String(user.accountType || '') !== 'partner_test') {
    return { error: 'Somente contas parceiro podem ser editadas por este endpoint', status: 400 };
  }

  const set = {};

  if (patch.name !== undefined) {
    const nm = String(patch.name || '').trim();
    if (!nm) return { error: 'name é obrigatório', status: 400 };
    set.name = nm;
  }
  if (patch.clinic !== undefined) {
    set.clinic = String(patch.clinic || '').trim();
  }
  if (patch.phone !== undefined) {
    set.phone = String(patch.phone || '').trim();
  }

  if (patch.planTier !== undefined) {
    const tierResult = normalizePartnerPlanTier(patch.planTier, { required: true });
    if (tierResult.error) return { error: tierResult.error, status: 400 };
    set.planTier = tierResult.tier;
  }

  if (patch.simulationCredits !== undefined) {
    const raw = Number(patch.simulationCredits);
    if (!Number.isFinite(raw) || raw < 0) {
      return { error: 'simulationCredits inválido', status: 400 };
    }
    set.simulationCreditsRemaining = Math.floor(raw);
    set.simulationMonthlyQuota = 0;
  }

  if (patch.previewCredits !== undefined) {
    const raw = Number(patch.previewCredits);
    if (!Number.isFinite(raw) || raw < 0) {
      return { error: 'previewCredits inválido', status: 400 };
    }
    const pts = Math.floor(raw);
    set.previewCreditsRemaining = pts;
    set.previewMonthlyQuota = pts;
  }

  const wantsExpiryClear =
    patch.clearPartnerTestExpiresAt === true ||
    patch.partnerTestExpiresAt === null ||
    patch.partnerTestExpiresAt === '';

  if (patch.partnerTestDurationDays !== undefined && patch.partnerTestDurationDays !== null && patch.partnerTestDurationDays !== '') {
    const days = Number(patch.partnerTestDurationDays);
    if (!Number.isFinite(days) || days <= 0) {
      return { error: 'partnerTestDurationDays inválido', status: 400 };
    }
    set.partnerTestExpiresAt = resolvePartnerTestExpiresAt({ partnerTestDurationDays: days });
  } else if (wantsExpiryClear) {
    set.partnerTestExpiresAt = null;
  } else if (patch.partnerTestExpiresAt !== undefined) {
    const expiresAt = resolvePartnerTestExpiresAt({
      partnerTestExpiresAt: patch.partnerTestExpiresAt,
    });
    if (expiresAt == null) {
      return { error: 'partnerTestExpiresAt inválido', status: 400 };
    }
    set.partnerTestExpiresAt = expiresAt;
  }

  if (Object.keys(set).length === 0) {
    return { user };
  }

  const updated = await User.findByIdAndUpdate(id, { $set: set }, { new: true });
  if (!updated) return { error: 'Usuário não encontrado', status: 404 };
  return { user: updated };
}

module.exports = {
  userToPublic,
  userToPublicWithOrgBilling,
  findUserByIdWithQuotaReset,
  findUserByEmail,
  createUser,
  createUserWithPassword,
  verifyPassword,
  updateUserById,
  updateUserPassword,
  findUserById,
  findUserByStripeCustomerId,
  findUserByStripeSubscriptionId,
  updateUserStripeFields,
  acceptUserTerms,
  createPartnerTestUser,
  updatePartnerTestUser,
  normalizePartnerPlanTier,
};
