const { google } = require('googleapis');
const crypto = require('crypto');

// Criar cliente OAuth2
function createOAuth2Client() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
}

// Gerar URL de autorização
function getAuthUrl(userId) {
  const oauth2Client = createOAuth2Client();

  // Scopes necessários:
  // - calendar.readonly: permite ler calendários (lista) e eventos
  // Isso é necessário para listar calendários disponíveis
  const scopes = [
    'https://www.googleapis.com/auth/calendar.readonly'
  ];

  // State com userId para segurança (criptografado)
  const stateData = {
    userId: userId.toString(),
    timestamp: Date.now()
  };
  const state = Buffer.from(JSON.stringify(stateData)).toString('base64');

  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline', // IMPORTANTE: para receber refresh_token
    prompt: 'consent', // Força mostrar tela de consentimento (garante refresh_token)
    scope: scopes,
    state: state
  });

  return { url, state };
}

// Validar state
function validateState(state) {
  try {
    const decoded = Buffer.from(state, 'base64').toString('utf8');
    const stateData = JSON.parse(decoded);
    
    // Verificar se não expirou (15 minutos - tempo suficiente para usuário autorizar)
    const fifteenMinutes = 15 * 60 * 1000;
    if (Date.now() - stateData.timestamp > fifteenMinutes) {
      throw new Error('State expirado');
    }
    
    return stateData.userId;
  } catch (error) {
    if (error.message === 'State expirado') {
      throw error;
    }
    throw new Error('State inválido');
  }
}

// Trocar code por tokens
async function exchangeCodeForTokens(code) {
  const oauth2Client = createOAuth2Client();

  try {
    const { tokens } = await oauth2Client.getToken(code);
    
    if (!tokens.refresh_token) {
      throw new Error('Refresh token não recebido. O usuário pode ter negado o consentimento ou já autorizou anteriormente.');
    }

    return {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiryDate: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
      scope: tokens.scope
    };
  } catch (error) {
    console.error('Erro ao trocar code por tokens:', error);
    throw new Error(`Erro ao obter tokens: ${error.message}`);
  }
}

// Renovar access token usando refresh token
async function refreshAccessToken(refreshToken) {
  const oauth2Client = createOAuth2Client();

  try {
    oauth2Client.setCredentials({
      refresh_token: refreshToken
    });

    const { credentials } = await oauth2Client.refreshAccessToken();

    return {
      accessToken: credentials.access_token,
      expiryDate: credentials.expiry_date ? new Date(credentials.expiry_date) : null
    };
  } catch (error) {
    console.error('Erro ao renovar access token:', error);
    
    // Se o refresh token for inválido/expirado, retornar erro específico
    if (error.response?.status === 400) {
      throw new Error('Refresh token inválido ou expirado. Reconecte sua conta do Google Calendar.');
    }
    
    throw new Error(`Erro ao renovar token: ${error.message}`);
  }
}

// Verificar se token está expirado ou próximo de expirar (5 minutos de margem)
function isTokenExpired(expiryDate) {
  if (!expiryDate) return true;
  
  const fiveMinutes = 5 * 60 * 1000;
  return new Date() >= new Date(expiryDate.getTime() - fiveMinutes);
}

// Obter informações do usuário do Google
async function getUserInfo(accessToken) {
  const oauth2Client = createOAuth2Client();
  oauth2Client.setCredentials({ access_token: accessToken });

  try {
    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
    const { data } = await oauth2.userinfo.get();
    
    return {
      email: data.email,
      name: data.name,
      picture: data.picture
    };
  } catch (error) {
    console.error('Erro ao obter informações do usuário:', error);
    return null;
  }
}

module.exports = {
  getAuthUrl,
  validateState,
  exchangeCodeForTokens,
  refreshAccessToken,
  isTokenExpired,
  getUserInfo,
  createOAuth2Client
};

