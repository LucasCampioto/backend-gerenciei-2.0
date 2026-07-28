const jwt = require('jsonwebtoken');
const {
  findUserByEmail,
  verifyPassword,
  userToPublic,
  findUserById,
  findUserByIdWithQuotaReset,
  updateUserPassword,
  acceptUserTerms,
} = require('../services/simulation/usersBilling');
const { LEGAL_VERSION } = require('../legal/version');

if (!process.env.JWT_SECRET) {
  console.error('❌ JWT_SECRET não está definido nas variáveis de ambiente!');
}

function signToken(user) {
  return jwt.sign(
    { userId: user._id, email: user.email },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' },
  );
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

    const token = signToken(user);
    const userWithQuota = (await findUserByIdWithQuotaReset(user._id)) || user;

    res.json({
      success: true,
      data: {
        user: userToPublic(userWithQuota),
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
      data: userToPublic(user),
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
      data: userToPublic(result.user),
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
      data: userToPublic(updated),
      message: 'Senha alterada com sucesso',
    });
  } catch (error) {
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
};
