const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Organization = require('../models/Organization');
const { OWNER_PERMISSIONS } = require('../constants/orgPermissions');

async function authenticate(req, res, next) {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        error: 'Token não fornecido',
      });
    }

    const token = authHeader.replace('Bearer ', '');
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const user = await User.findById(decoded.userId);
    if (!user) {
      return res.status(401).json({
        success: false,
        error: 'Usuário não encontrado',
      });
    }

    if (user.status === 'disabled') {
      return res.status(403).json({
        success: false,
        error: 'Conta desativada. Contate o administrador da organização.',
      });
    }

    req.userId = user._id;
    req.userEmail = user.email;
    req.user = user;
    req.orgId = user.organizationId || null;
    req.role = user.role || null;
    req.permissions = Array.isArray(user.permissions) ? user.permissions : [];

    // Owners legados sem role explícita: tratar como owner full até o backfill
    if (req.orgId && !req.role) {
      req.role = 'owner';
      req.permissions = [...OWNER_PERMISSIONS];
    }

    if (req.orgId) {
      const org = await Organization.findById(req.orgId).select('ownerUserId name').lean();
      req.orgOwnerUserId = org?.ownerUserId || null;
      req.orgName = org?.name || null;
    } else {
      req.orgOwnerUserId = null;
      req.orgName = null;
    }

    next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        success: false,
        error: 'Token inválido',
      });
    }

    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        error: 'Token expirado',
      });
    }

    return res.status(401).json({
      success: false,
      error: 'Erro na autenticação',
    });
  }
}

module.exports = { authenticate };
