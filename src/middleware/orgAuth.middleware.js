const {
  roleHasPermission,
  isOrgAdminRole,
} = require('../constants/orgPermissions');

/**
 * Exige que o usuário autenticado tenha permissão de módulo/tela.
 * Owner sempre passa; admin passa em tudo exceto assinatura (salvo se marcado).
 */
function requirePermission(moduleId) {
  return requireAnyPermission(moduleId);
}

function requireAnyPermission(...moduleIds) {
  const ids = moduleIds.filter(Boolean);
  return function requireAnyPermissionMiddleware(req, res, next) {
    if (!req.userId) {
      return res.status(401).json({ success: false, error: 'Não autenticado' });
    }

    if (!req.orgId) {
      return next();
    }

    const role = req.role || 'member';
    if (ids.some((moduleId) => roleHasPermission(role, req.permissions, moduleId))) {
      return next();
    }

    return res.status(403).json({
      success: false,
      error: 'Sem permissão para este módulo',
    });
  };
}

/**
 * Exige role owner ou admin (gestão de equipe / visão completa).
 */
function requireOrgAdmin(req, res, next) {
  if (!req.userId) {
    return res.status(401).json({ success: false, error: 'Não autenticado' });
  }
  if (!req.orgId) {
    // Pré-migração: o próprio user é o "admin" implícito
    return next();
  }
  if (!isOrgAdminRole(req.role)) {
    return res.status(403).json({
      success: false,
      error: 'Apenas administradores da organização podem realizar esta ação',
    });
  }
  return next();
}

function requireOwner(req, res, next) {
  if (!req.userId) {
    return res.status(401).json({ success: false, error: 'Não autenticado' });
  }
  if (!req.orgId) {
    return next();
  }
  if (req.role !== 'owner') {
    return res.status(403).json({
      success: false,
      error: 'Apenas o owner da organização pode realizar esta ação',
    });
  }
  return next();
}

module.exports = {
  requirePermission,
  requireAnyPermission,
  requireOrgAdmin,
  requireOwner,
};
