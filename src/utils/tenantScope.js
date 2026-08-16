/**
 * Escopo de tenant com dual-read seguro.
 *
 * - Com organizationId: docs da org OU docs legados do owner ainda sem organizationId.
 * - Sem org (pré-login migrate): filtra por userId do logado.
 * - Writes: organizationId + userId do owner (compat) + createdByUserId (ator).
 * - Membros (não admin): listagens “minhas” usam actorScopedTenantFilter (createdByUserId).
 */

const mongoose = require('mongoose');
const { isOrgAdminRole } = require('../constants/orgPermissions');

function toObjectId(id) {
  if (!id) return null;
  if (id instanceof mongoose.Types.ObjectId) return id;
  if (mongoose.Types.ObjectId.isValid(id)) return new mongoose.Types.ObjectId(id);
  return null;
}

function isOrgAdminRequest(req) {
  if (!req.orgId) return true; // legado single-user
  return isOrgAdminRole(req.role);
}

/** Combina filtros sem sobrescrever $or internos. */
function andFilters(...parts) {
  const cleaned = parts.filter((p) => p && typeof p === 'object' && Object.keys(p).length > 0);
  if (cleaned.length === 0) return {};
  if (cleaned.length === 1) return cleaned[0];
  return { $and: cleaned };
}

/**
 * Filtro de listagem / busca de documentos de negócio.
 */
function tenantFilter(req) {
  const orgId = toObjectId(req.orgId);
  const ownerId = toObjectId(req.orgOwnerUserId) || toObjectId(req.userId);

  if (orgId && ownerId) {
    return {
      $or: [
        { organizationId: orgId },
        {
          userId: ownerId,
          $or: [{ organizationId: null }, { organizationId: { $exists: false } }],
        },
      ],
    };
  }

  if (orgId) {
    return { organizationId: orgId };
  }

  return { userId: toObjectId(req.userId) };
}

/**
 * Tenant + restrição de ator para membros:
 * - owner/admin: tudo da org
 * - member: só docs com createdByUserId = req.userId
 */
function actorScopedTenantFilter(req) {
  const base = tenantFilter(req);
  if (isOrgAdminRequest(req)) return base;
  const actorId = toObjectId(req.userId);
  if (!actorId) return base;
  return andFilters(base, { createdByUserId: actorId });
}

/**
 * Filtro para um doc por id dentro do tenant (anti-IDOR).
 */
function tenantDocFilter(req, docId) {
  return andFilters({ _id: docId }, tenantFilter(req));
}

/**
 * Doc por id + escopo de ator (membro só o próprio).
 */
function actorScopedDocFilter(req, docId) {
  return andFilters({ _id: docId }, actorScopedTenantFilter(req));
}

/**
 * Campos a setar em create de negócio.
 */
function tenantCreateFields(req) {
  const actorId = toObjectId(req.userId);
  const ownerId = toObjectId(req.orgOwnerUserId) || actorId;
  const fields = {
    userId: ownerId,
  };
  const orgId = toObjectId(req.orgId);
  if (orgId) fields.organizationId = orgId;
  if (actorId) fields.createdByUserId = actorId;
  return fields;
}

/**
 * Garante que um documento carregado pertence ao tenant atual.
 */
function assertSameTenant(req, doc) {
  if (!doc) return false;
  const orgId = toObjectId(req.orgId);
  const ownerId = toObjectId(req.orgOwnerUserId) || toObjectId(req.userId);

  if (orgId) {
    if (doc.organizationId && String(doc.organizationId) === String(orgId)) return true;
    if (!doc.organizationId && ownerId && String(doc.userId) === String(ownerId)) return true;
    return false;
  }
  return String(doc.userId) === String(req.userId);
}

/**
 * Membro só acessa o que ele criou; admin/owner acessa qualquer doc do tenant.
 */
function assertActorCanAccessDoc(req, doc) {
  if (!assertSameTenant(req, doc)) return false;
  if (isOrgAdminRequest(req)) return true;
  if (!doc.createdByUserId) return false;
  return String(doc.createdByUserId) === String(req.userId);
}

/**
 * UserId "dono dos dados" para services legados que ainda filtram só por userId.
 * Com org: owner da org. Sem org: o próprio usuário.
 */
function scopeUserId(req) {
  return req.orgOwnerUserId || req.userId;
}

module.exports = {
  toObjectId,
  andFilters,
  isOrgAdminRequest,
  tenantFilter,
  actorScopedTenantFilter,
  tenantDocFilter,
  actorScopedDocFilter,
  tenantCreateFields,
  assertSameTenant,
  assertActorCanAccessDoc,
  scopeUserId,
};
