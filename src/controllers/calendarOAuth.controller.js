const User = require('../models/User');
const { getAuthUrl, validateState, exchangeCodeForTokens, getUserInfo } = require('../services/googleOAuth.service');
const { resolvePreferredCalendar, getCalendarsList } = require('../services/googleCalendar.service');

// Iniciar fluxo OAuth - retorna URL para front-end redirecionar
async function initiateOAuth(req, res, next) {
  try {
    const userId = req.userId; // Do middleware authenticate

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'Usuário não autenticado'
      });
    }

    // Gerar URL de autorização
    const { url } = getAuthUrl(userId);

    res.json({
      success: true,
      data: {
        authUrl: url
      },
      message: 'URL de autorização gerada com sucesso'
    });
  } catch (error) {
    console.error('Erro ao iniciar OAuth:', error);
    next(error);
  }
}

// Callback do Google OAuth
async function handleOAuthCallback(req, res, next) {
  // Definir URL do front-end uma única vez (porta 8080 como padrão)
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:8080';
  
  console.log('🔔 [OAUTH CALLBACK] Recebido:', {
    method: req.method,
    url: req.url,
    query: req.query,
    frontendUrl
  });
  
  try {
    const { code, state, error: oauthError } = req.query;

    // Se o usuário negou permissões
    if (oauthError) {
      return res.redirect(`${frontendUrl}/agenda?error=${encodeURIComponent('Permissões negadas pelo usuário')}`);
    }

    // Validar parâmetros obrigatórios
    if (!code || !state) {
      return res.redirect(`${frontendUrl}/agenda?error=${encodeURIComponent('Parâmetros inválidos')}`);
    }

    // Validar state e obter userId
    let userId;
    try {
      userId = validateState(state);
    } catch (error) {
      return res.redirect(`${frontendUrl}/agenda?error=${encodeURIComponent('State inválido ou expirado')}`);
    }

    // Verificar se usuário existe
    const user = await User.findById(userId);
    if (!user) {
      return res.redirect(`${frontendUrl}/agenda?error=${encodeURIComponent('Usuário não encontrado')}`);
    }

    // Trocar code por tokens
    let tokens;
    try {
      tokens = await exchangeCodeForTokens(code);
    } catch (error) {
      console.error('Erro ao trocar code por tokens:', error);
      return res.redirect(`${frontendUrl}/agenda?error=${encodeURIComponent(error.message)}`);
    }

    // Obter informações do usuário do Google (opcional)
    let userInfo = null;
    try {
      userInfo = await getUserInfo(tokens.accessToken);
    } catch (error) {
      console.warn('Não foi possível obter informações do usuário:', error);
    }

    // Salvar tokens no banco primeiro
    user.googleRefreshToken = tokens.refreshToken;
    user.googleAccessToken = tokens.accessToken;
    user.googleTokenExpiry = tokens.expiryDate;
    user.googleCalendarConnected = true;
    
    if (userInfo && userInfo.email) {
      user.googleCalendarEmail = userInfo.email;
    }

    // Salvar tokens primeiro para que getPrimaryCalendarId possa usar
    await user.save();
    console.log('✅ [OAUTH] Tokens salvos no banco');

    // Buscar e salvar calendário principal (após salvar tokens)
    try {
      console.log('🔍 [OAUTH] Buscando calendário preferido do usuário...');
      const preferred = await resolvePreferredCalendar(userId);
      user.googleCalendarId = preferred.id;
      user.googleCalendarName = preferred.summary;
      console.log('✅ [OAUTH] Calendário preferido:', preferred.summary, preferred.id);
      await user.save();
    } catch (error) {
      console.warn('⚠️ [OAUTH] Erro ao buscar calendário preferido, usando "primary":', error.message);
      user.googleCalendarId = 'primary';
      user.googleCalendarName = 'Principal';
      await user.save();
    }

    console.log('✅ [OAUTH] Google Calendar conectado para usuário:', userId);

    // Redirecionar para página de agenda
    res.redirect(`${frontendUrl}/agenda`);
  } catch (error) {
    console.error('Erro no callback OAuth:', error);
    res.redirect(`${frontendUrl}/agenda?error=${encodeURIComponent('Erro ao processar autorização')}`);
  }
}

// Desconectar Google Calendar
async function disconnectCalendar(req, res, next) {
  try {
    const userId = req.userId;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'Usuário não encontrado'
      });
    }

    // Remover tokens e desativar conexão
    user.googleRefreshToken = null;
    user.googleAccessToken = null;
    user.googleTokenExpiry = null;
    user.googleCalendarConnected = false;
    user.googleCalendarEmail = null;
    user.googleCalendarId = null;
    user.googleCalendarName = null;

    await user.save();

    res.json({
      success: true,
      message: 'Google Calendar desconectado com sucesso'
    });
  } catch (error) {
    console.error('Erro ao desconectar Calendar:', error);
    next(error);
  }
}

// Verificar status de conexão
async function getConnectionStatus(req, res, next) {
  try {
    const userId = req.userId;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'Usuário não encontrado'
      });
    }

    res.json({
      success: true,
      data: {
        connected: user.googleCalendarConnected || false,
        email: user.googleCalendarEmail || null,
        calendarId: user.googleCalendarId || null,
        calendarName: user.googleCalendarName || null,
        connectedAt: user.updatedAt // Última atualização (quando conectou)
      }
    });
  } catch (error) {
    console.error('Erro ao verificar status:', error);
    next(error);
  }
}

async function setPreferredCalendar(req, res, next) {
  try {
    const userId = req.userId;
    const { calendarId, calendarName } = req.body;

    if (!calendarId || typeof calendarId !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'calendarId é obrigatório',
      });
    }

    const user = await User.findById(userId);
    if (!user?.googleCalendarConnected) {
      return res.status(400).json({
        success: false,
        error: 'Conecte o Google Calendar antes de escolher um calendário.',
      });
    }

    const calendars = await getCalendarsList(userId);
    const selected = calendars.find((cal) => cal.id === calendarId);
    if (!selected) {
      return res.status(400).json({
        success: false,
        error: 'Calendário não encontrado na sua conta Google.',
      });
    }

    user.googleCalendarId = selected.id;
    user.googleCalendarName = calendarName || selected.summary;
    await user.save();

    res.json({
      success: true,
      data: {
        calendarId: user.googleCalendarId,
        calendarName: user.googleCalendarName,
      },
      message: 'Calendário preferido atualizado',
    });
  } catch (error) {
    console.error('Erro ao salvar calendário preferido:', error);
    next(error);
  }
}

async function syncFamilyCalendar(req, res, next) {
  try {
    const userId = req.userId;
    const user = await User.findById(userId);

    if (!user?.googleCalendarConnected) {
      return res.status(400).json({
        success: false,
        error: 'Google Calendar não conectado.',
      });
    }

    const preferred = await resolvePreferredCalendar(userId);
    user.googleCalendarId = preferred.id;
    user.googleCalendarName = preferred.summary;
    await user.save();

    res.json({
      success: true,
      data: {
        calendarId: user.googleCalendarId,
        calendarName: user.googleCalendarName,
      },
    });
  } catch (error) {
    console.error('Erro ao sincronizar calendário Family:', error);
    next(error);
  }
}

module.exports = {
  initiateOAuth,
  handleOAuthCallback,
  disconnectCalendar,
  getConnectionStatus,
  setPreferredCalendar,
  syncFamilyCalendar,
};

