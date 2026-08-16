const Organization = require('../models/Organization');
const User = require('../models/User');
const { OWNER_PERMISSIONS } = require('../constants/orgPermissions');

/**
 * Cria Organization e associa o User como owner (idempotente se já tiver organizationId).
 */
async function ensureOwnerOrganization(user, { name } = {}) {
  if (!user) throw new Error('user required');

  if (user.organizationId) {
    const existing = await Organization.findById(user.organizationId);
    if (existing) {
      if (!user.role) {
        user.role = 'owner';
        user.permissions = [...OWNER_PERMISSIONS];
        user.status = user.status || 'active';
        await user.save();
      }
      return { organization: existing, user };
    }
  }

  const orgName =
    String(name || user.clinic || user.name || 'Minha organização').trim() || 'Minha organização';

  const organization = await Organization.create({
    name: orgName,
    ownerUserId: user._id,
  });

  user.organizationId = organization._id;
  user.role = 'owner';
  user.permissions = [...OWNER_PERMISSIONS];
  user.status = 'active';
  user.mustSetPassword = user.mustSetPassword === true;
  await user.save();

  return { organization, user };
}

/**
 * Provisiona conta nova: User owner + Organization na mesma operação lógica.
 * Usado por createUserWithPassword / partner test.
 */
async function attachOrgAfterUserCreate(user, { name } = {}) {
  return ensureOwnerOrganization(user, { name });
}

async function findOrganizationById(organizationId) {
  if (!organizationId) return null;
  return Organization.findById(organizationId);
}

async function listMembers(organizationId) {
  return User.find({ organizationId })
    .select(
      'name email role permissions status mustSetPassword clinic phone createdAt updatedAt organizationId',
    )
    .sort({ role: 1, name: 1 })
    .lean();
}

function memberToPublic(doc) {
  return {
    id: String(doc._id),
    name: doc.name,
    email: doc.email,
    role: doc.role || 'member',
    permissions: Array.isArray(doc.permissions) ? doc.permissions : [],
    status: doc.status || 'active',
    mustSetPassword: doc.mustSetPassword === true,
    clinic: doc.clinic || '',
    phone: doc.phone || '',
    organizationId: doc.organizationId ? String(doc.organizationId) : null,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

module.exports = {
  ensureOwnerOrganization,
  attachOrgAfterUserCreate,
  findOrganizationById,
  listMembers,
  memberToPublic,
};
