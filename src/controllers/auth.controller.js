const { createHash, randomBytes } = require('crypto');
const jwt = require('jsonwebtoken');
const {
  findUserByEmail,
  verifyPassword,
  userToPublicWithOrgBilling,
  findUserById,
  findUserByIdWithQuotaReset,
  updateUserPassword,
  acceptUserTerms,
} = require('../services/simulation/usersBilling');
const { LEGAL_VERSION } = require('../legal/version');
const PasswordResetToken = require('../models/PasswordResetToken');
const { sendPasswordResetEmail } = require('../services/simulation/email');
const {
  acceptInvite,
  getInvitePreview,
} = require('../services/invite.service');
const { OWNER_PERMISSIONS } = require('../constants/orgPermissions');

if (!process.env.JWT_SECRET) {
  console.error('❌ JWT_SECRET não está definido nas variáveis de ambiente!');
}

function signToken(user) {
  const payload = {
    userId: user._id,
    email: user.email,
  };
  if (user.organizationId) {
    payload.organizationId = user.organizationId;
    payload.role = user.role || 'owner';
  }
  return jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  });
}

function resetPasswordFrontUrl(rawToken) {
  const explicit = (process.env.FRONTEND_RESET_PASSWORD_URL || '').trim();
  if (explicit) {
    const base = explicit.replace(/\/$/, '');
    const sep = base.includes('?') ? '&' : '?';
    return `${base}${sep}token=${encodeURIComponent(rawToken)}`;
  }
  const origin = String(
    process.env.FRONTEND_URL || process.env.CORS_ORIGIN || 'http://localhost:8080',
  ).replace(/\/$/, '');
  return `${origin}/redefinir-senha?token=${encodeURIComponent(rawToken)}`;
}

function hashToken(raw) {
  return createHash('sha256').update(String(raw)).digest('hex');
}

/** Cadastro público desativado — conta criada via checkout Stripe ou admin. */
async function signup(_req, res) {
  res.status(403).json({
    success: false,
    error:
      'Cadastro público desativado. Assine um plano em nosso site ou utilize a conta criada pelo administrador.',
    message:
      'Cadastro público desativado. Assine um plano em nosso site ou utilize a conta criada pelo administrador.',
  });
}

async function login(req, res, next) {
  try {
    if (!process.env.JWT_SECRET) {
      return res.status(500).json({
        success: false,
        error: 'Configuração do servidor incompleta',
      });
    }

    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        error: 'E-mail e senha são obrigatórios',
      });
    }

    const user = await findUserByEmail(email);
    if (!user || !(await verifyPassword(user, password))) {
      return res.status(401).json({
        success: false,
        error: 'Email ou senha inválidos',
      });
    }

    if (user.status === 'disabled') {
      return res.status(403).json({
        success: false,
        error: 'Conta desativada. Contate o administrador da organização.',
      });
    }

    // Lazy: conta antiga sem org — provisiona no login (idempotente)
    if (!user.organizationId) {
      const { ensureOwnerOrganization } = require('../services/organization.service');
      await ensureOwnerOrganization(user, { name: user.clinic || user.name });
    } else if (!user.role) {
      user.role = 'owner';
      user.permissions = [...OWNER_PERMISSIONS];
      user.status = user.status || 'active';
      await user.save();
    }

    const token = signToken(user);
    const userWithQuota = (await findUserByIdWithQuotaReset(user._id)) || user;

    res.json({
      success: true,
      data: {
        user: await userToPublicWithOrgBilling(userWithQuota),
        token,
      },
      message: 'Login realizado com sucesso',
    });
  } catch (error) {
    next(error);
  }
}

async function logout(req, res, next) {
  try {
    res.json({
      success: true,
      message: 'Logout realizado com sucesso',
    });
  } catch (error) {
    next(error);
  }
}

async function getMe(req, res, next) {
  try {
    const user = await findUserByIdWithQuotaReset(req.userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'Usuário não encontrado',
      });
    }

    res.json({
      success: true,
      data: await userToPublicWithOrgBilling(user),
    });
  } catch (error) {
    next(error);
  }
}

async function acceptTerms(req, res, next) {
  try {
    const { termsVersion, acceptTerms: acceptTermsFlag, acceptPrivacy, acceptPatientResponsibility } =
      req.body || {};
    const version = String(termsVersion || '').trim();
    if (version !== LEGAL_VERSION) {
      return res.status(400).json({
        success: false,
        error: 'Versão dos termos desatualizada. Recarregue a página e tente novamente.',
        message: 'Versão dos termos desatualizada. Recarregue a página e tente novamente.',
      });
    }
    const result = await acceptUserTerms(req.userId, {
      termsVersion: version,
      acceptTerms: acceptTermsFlag === true,
      acceptPrivacy: acceptPrivacy === true,
      acceptPatientResponsibility: acceptPatientResponsibility === true,
    });
    if (result.error) {
      return res.status(result.status || 400).json({
        success: false,
        error: result.error,
        message: result.error,
      });
    }
    res.json({
      success: true,
      data: await userToPublicWithOrgBilling(result.user),
    });
  } catch (error) {
    next(error);
  }
}

async function changePassword(req, res, next) {
  try {
    const { currentPassword, newPassword } = req.body || {};
    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        error: 'Senha atual e nova senha são obrigatórias',
      });
    }
    if (String(newPassword).length < 8) {
      return res.status(400).json({
        success: false,
        error: 'A nova senha deve ter pelo menos 8 caracteres',
      });
    }

    const user = await findUserById(req.userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'Usuário não encontrado',
      });
    }
    if (!(await verifyPassword(user, currentPassword))) {
      return res.status(401).json({
        success: false,
        error: 'Senha atual inválida',
      });
    }

    const updated = await updateUserPassword(user._id, newPassword, { firstAccess: false });
    if (!updated) {
      return res.status(404).json({
        success: false,
        error: 'Usuário não encontrado',
      });
    }

    res.json({
      success: true,
      data: await userToPublicWithOrgBilling(updated),
      message: 'Senha alterada com sucesso',
    });
  } catch (error) {
    next(error);
  }
}

async function forgotPassword(req, res, next) {
  const GENERIC_OK = {
    success: true,
    message: 'Se este e-mail estiver cadastrado, você receberá as instruções.',
  };
  try {
    const { email } = req.body || {};
    if (!email || typeof email !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'E-mail é obrigatório',
      });
    }

    const user = await findUserByEmail(email);
    if (!user || user.status === 'disabled') {
      return res.json(GENERIC_OK);
    }

    const rawToken = randomBytes(32).toString('hex');
    const tokenHash = hashToken(rawToken);
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

    await PasswordResetToken.deleteMany({ userId: user._id });
    await PasswordResetToken.create({
      userId: user._id,
      token: tokenHash,
      expiresAt,
    });

    await sendPasswordResetEmail({
      to: user.email,
      resetUrl: resetPasswordFrontUrl(rawToken),
    });

    return res.json(GENERIC_OK);
  } catch (error) {
    next(error);
  }
}

async function resetPassword(req, res, next) {
  try {
    const { token, newPassword } = req.body || {};
    if (!token || !newPassword) {
      return res.status(400).json({
        success: false,
        error: 'Token e nova senha são obrigatórios',
      });
    }
    if (String(newPassword).length < 8) {
      return res.status(400).json({
        success: false,
        error: 'A senha deve ter pelo menos 8 caracteres',
      });
    }

    const tokenHash = hashToken(String(token));
    const record = await PasswordResetToken.findOne({
      token: tokenHash,
      expiresAt: { $gt: new Date() },
    });

    if (!record) {
      return res.status(400).json({
        success: false,
        error: 'Link inválido ou expirado.',
      });
    }

    await updateUserPassword(record.userId, newPassword, { firstAccess: false });
    await PasswordResetToken.deleteOne({ _id: record._id });

    return res.json({
      success: true,
      message: 'Senha redefinida com sucesso.',
    });
  } catch (error) {
    next(error);
  }
}

async function previewInvite(req, res, next) {
  try {
    const token = String(req.query.token || req.body?.token || '').trim();
    const preview = await getInvitePreview(token);
    if (!preview) {
      return res.status(400).json({
        success: false,
        error: 'Convite inválido ou expirado',
      });
    }
    return res.json({ success: true, data: preview });
  } catch (error) {
    next(error);
  }
}

async function acceptInviteHandler(req, res, next) {
  try {
    if (!process.env.JWT_SECRET) {
      return res.status(500).json({
        success: false,
        error: 'Configuração do servidor incompleta',
      });
    }
    const { token, password } = req.body || {};
    const { user } = await acceptInvite({ token, password });
    const tokenJwt = signToken(user);
    return res.json({
      success: true,
      data: {
        user: await userToPublicWithOrgBilling(user),
        token: tokenJwt,
      },
      message: 'Convite aceito com sucesso',
    });
  } catch (error) {
    if (error.status) {
      return res.status(error.status).json({
        success: false,
        error: error.message,
      });
    }
    next(error);
  }
}

module.exports = {
  signup,
  login,
  logout,
  getMe,
  acceptTerms,
  changePassword,
  forgotPassword,
  resetPassword,
  previewInvite,
  acceptInviteHandler,
};
