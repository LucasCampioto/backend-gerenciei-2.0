const { google } = require('googleapis');
const crypto = require('crypto');

function getStateSecret() {
  return (
    String(process.env.OAUTH_STATE_SECRET || process.env.JWT_SECRET || '').trim() || null
  );
}

function toBase64Url(bufferOrString) {
  const buf = Buffer.isBuffer(bufferOrString)
    ? bufferOrString
    : Buffer.from(String(bufferOrString), 'utf8');
  return buf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function fromBase64Url(value) {
  const padded = String(value)
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  const padLength = (4 - (padded.length % 4)) % 4;
  return Buffer.from(padded + '='.repeat(padLength), 'base64').toString('utf8');
}

function signPayload(payloadB64) {
  const secret = getStateSecret();
  if (!secret) {
    throw new Error('OAUTH_STATE_SECRET/JWT_SECRET não configurado');
  }
  return toBase64Url(
    crypto.createHmac('sha256', secret).update(payloadB64).digest()
  );
}

function safeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/** Build signed OAuth state: base64url(JSON).hmac */
function buildSignedState(userId) {
  const stateData = {
    userId: userId.toString(),
    timestamp: Date.now(),
  };
  const payloadB64 = toBase64Url(JSON.stringify(stateData));
  const sig = signPayload(payloadB64);
  return `${payloadB64}.${sig}`;
}

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

  // State assinado com HMAC (userId + timestamp)
  const state = buildSignedState(userId);

  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline', // IMPORTANTE: para receber refresh_token
    prompt: 'consent', // Força mostrar tela de consentimento (garante refresh_token)
    scope: scopes,
    state: state
  });

  return { url, state };
}

// Validar state assinado
function validateState(state) {
  try {
    if (!state || typeof state !== 'string' || !state.includes('.')) {
      throw new Error('State inválido');
    }

    const [payloadB64, sig] = state.split('.');
    if (!payloadB64 || !sig) {
      throw new Error('State inválido');
    }

    const expected = signPayload(payloadB64);
    if (!safeEqual(sig, expected)) {
      throw new Error('State inválido');
    }

    const stateData = JSON.parse(fromBase64Url(payloadB64));
    if (!stateData?.userId || !stateData?.timestamp) {
      throw new Error('State inválido');
    }

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
  buildSignedState,
  exchangeCodeForTokens,
  refreshAccessToken,
  isTokenExpired,
  getUserInfo,
  createOAuth2Client
};
