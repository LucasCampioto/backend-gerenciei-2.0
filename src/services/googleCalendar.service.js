const { google } = require('googleapis');
const User = require('../models/User');
const { refreshAccessToken, isTokenExpired, createOAuth2Client } = require('./googleOAuth.service');

// Obter cliente do Google Calendar para um usuário específico
async function getCalendarClientForUser(userId) {
  try {
    // Buscar usuário no banco
    const user = await User.findById(userId);
    
    if (!user) {
      throw new Error('Usuário não encontrado');
    }

    if (!user.googleCalendarConnected || !user.googleRefreshToken) {
      throw new Error('Usuário não conectou o Google Calendar. Conecte sua conta primeiro.');
    }

    // Verificar se precisa renovar o access token
    let accessToken = user.googleAccessToken;
    let expiryDate = user.googleTokenExpiry;

    if (!accessToken || isTokenExpired(expiryDate)) {
      console.log('🔄 [GOOGLE CALENDAR] Renovando access token para usuário:', userId);
      
      // Renovar token
      const newTokens = await refreshAccessToken(user.googleRefreshToken);
      
      // Atualizar no banco
      user.googleAccessToken = newTokens.accessToken;
      user.googleTokenExpiry = newTokens.expiryDate;
      await user.save();
      
      accessToken = newTokens.accessToken;
      expiryDate = newTokens.expiryDate;
      
      console.log('✅ [GOOGLE CALENDAR] Token renovado com sucesso');
    }

    // Criar cliente OAuth2
    const oauth2Client = createOAuth2Client();
    oauth2Client.setCredentials({
      access_token: accessToken,
      refresh_token: user.googleRefreshToken
    });

    // Criar cliente do Calendar
    const calendarClient = google.calendar({ version: 'v3', auth: oauth2Client });

    return calendarClient;
  } catch (error) {
    console.error('❌ [GOOGLE CALENDAR] Erro ao obter cliente para usuário:', error);
    throw error;
  }
}

// Formatar evento do Google Calendar para padrão da API
function formatEvent(event) {
  const formatted = {
    id: event.id,
    summary: event.summary || '', // Nome da pessoa/evento
    description: event.description || '',
    start: event.start?.dateTime || event.start?.date || null,
    end: event.end?.dateTime || event.end?.date || null,
    location: event.location || '',
    attendees: (event.attendees || []).map(attendee => ({
      email: attendee.email,
      displayName: attendee.displayName || attendee.email
    })),
    status: event.status || 'confirmed',
    htmlLink: event.htmlLink || '',
    creator: event.creator ? {
      email: event.creator.email,
      displayName: event.creator.displayName
    } : null
  };
  
  return formatted;
}

// Buscar eventos do Google Calendar para um usuário específico
async function getEvents(userId, options = {}) {
  try {
    console.log('📆 [GOOGLE CALENDAR] Buscando eventos para usuário:', userId);
    console.log('📆 [GOOGLE CALENDAR] Opções recebidas:', JSON.stringify(options, null, 2));
    
    // Obter cliente do Calendar para o usuário
    const calendar = await getCalendarClientForUser(userId);
    
    // Extrair parâmetros das options, garantindo que calendarId seja preservado
    const calendarId = options.calendarId || 'primary';
    const timeMin = options.timeMin;
    const timeMax = options.timeMax;
    const maxResults = options.maxResults || 50;
    const singleEvents = options.singleEvents !== undefined ? options.singleEvents : true;
    const orderBy = options.orderBy || 'startTime';

    console.log('📆 [GOOGLE CALENDAR] Parâmetros extraídos:');
    console.log('  - Calendar ID:', calendarId);
    console.log('  - timeMin:', timeMin);
    console.log('  - timeMax:', timeMax);
    console.log('  - maxResults:', maxResults);

    const params = {
      calendarId,
      timeMin: timeMin || new Date().toISOString(),
      maxResults: Math.min(maxResults, 2500), // Limite da API
      singleEvents,
      orderBy
    };

    if (timeMax) {
      params.timeMax = timeMax;
    }

    console.log('📆 [GOOGLE CALENDAR] Parâmetros finais que serão enviados para API:');
    console.log('  - calendarId:', params.calendarId);
    console.log('  - timeMin:', params.timeMin);
    console.log('  - timeMax:', params.timeMax || 'não definido');
    console.log('  - maxResults:', params.maxResults);
    console.log('📆 [GOOGLE CALENDAR] Parâmetros completos (JSON):', JSON.stringify(params, null, 2));
    
    try {
      const response = await calendar.events.list(params);
      console.log('📆 [GOOGLE CALENDAR] Resposta recebida da API');
      console.log('📆 [GOOGLE CALENDAR] Status:', response.status);
      console.log('📆 [GOOGLE CALENDAR] Total de eventos retornados pela API:', response.data.items?.length || 0);
      console.log('📆 [GOOGLE CALENDAR] Calendar ID usado:', calendarId);
      console.log('📆 [GOOGLE CALENDAR] Período de busca:', { timeMin, timeMax });
      
      if (response.data.items && response.data.items.length > 0) {
        console.log('📆 [GOOGLE CALENDAR] Primeiro evento (amostra):', JSON.stringify(response.data.items[0], null, 2));
      } else {
        console.log('⚠️ [GOOGLE CALENDAR] Nenhum evento encontrado no período especificado');
        console.log('⚠️ [GOOGLE CALENDAR] Verifique se há eventos no calendário "primary" do usuário entre', timeMin, 'e', timeMax);
      }
      
      const events = (response.data.items || []).map(formatEvent);
      console.log('📆 [GOOGLE CALENDAR] Eventos formatados:', events.length, 'eventos');

      return events;
    } catch (apiError) {
      console.error('❌ [GOOGLE CALENDAR] Erro na chamada da API:', apiError);
      throw apiError;
    }
  } catch (error) {
    console.error('❌ [GOOGLE CALENDAR] Erro ao buscar eventos:', error);
    console.error('❌ [GOOGLE CALENDAR] Detalhes:', {
      message: error.message,
      code: error.code,
      response: error.response?.data,
      status: error.response?.status
    });
    
    // Tratar erros específicos
    if (error.code === 401) {
      throw new Error('Credenciais inválidas ou expiradas. Reconecte sua conta do Google Calendar.');
    }
    
    if (error.code === 403) {
      const errorMessage = error.response?.data?.error?.message || error.message;
      throw new Error(`Sem permissões para acessar o calendário. Detalhes: ${errorMessage}`);
    }
    
    if (error.code === 404) {
      throw new Error(`Calendário não encontrado. Verifique se o ID está correto: ${options?.calendarId || 'primary'}`);
    }
    
    // Se for erro de token inválido/expirado, propagar mensagem específica
    if (error.message.includes('Refresh token inválido') || error.message.includes('não conectou')) {
      throw error;
    }
    
    throw new Error(`Erro ao buscar eventos: ${error.message}`);
  }
}

// Buscar lista completa de calendários do usuário
async function getCalendarsList(userId) {
  try {
    console.log('📋 [GOOGLE CALENDAR] Buscando lista de calendários para usuário:', userId);
    
    // Obter cliente do Calendar para o usuário
    const calendar = await getCalendarClientForUser(userId);
    
    // Buscar lista de calendários
    const response = await calendar.calendarList.list({
      minAccessRole: 'reader' // Apenas calendários que o usuário pode ler
    });
    
    const calendars = response.data.items || [];
    console.log('📋 [GOOGLE CALENDAR] Total de calendários encontrados:', calendars.length);
    
    // Formatar lista de calendários
    const formattedCalendars = calendars.map(cal => ({
      id: cal.id,
      summary: cal.summary || 'Sem nome',
      description: cal.description || null,
      primary: cal.primary || false,
      accessRole: cal.accessRole || 'reader',
      backgroundColor: cal.backgroundColor || null,
      foregroundColor: cal.foregroundColor || null,
      timeZone: cal.timeZone || null
    }));
    
    return formattedCalendars;
  } catch (error) {
    console.error('❌ [GOOGLE CALENDAR] Erro ao buscar lista de calendários:', error);
    throw error;
  }
}

// Buscar lista de calendários do usuário e retornar o principal
async function getPrimaryCalendarId(userId) {
  try {
    console.log('📋 [GOOGLE CALENDAR] Buscando calendário principal para usuário:', userId);
    
    // Obter cliente do Calendar para o usuário
    const calendar = await getCalendarClientForUser(userId);
    
    // Buscar lista de calendários
    const response = await calendar.calendarList.list({
      minAccessRole: 'reader' // Apenas calendários que o usuário pode ler
    });
    
    const calendars = response.data.items || [];
    console.log('📋 [GOOGLE CALENDAR] Total de calendários encontrados:', calendars.length);
    
    // Procurar calendário "primary" (calendário principal do usuário)
    let primaryCalendar = calendars.find(cal => cal.primary === true);
    
    // Se não encontrar "primary", pegar o primeiro calendário da lista
    if (!primaryCalendar && calendars.length > 0) {
      primaryCalendar = calendars[0];
      console.log('📋 [GOOGLE CALENDAR] Calendário "primary" não encontrado, usando primeiro da lista');
    }
    
    if (primaryCalendar) {
      const calendarId = primaryCalendar.id;
      console.log('📋 [GOOGLE CALENDAR] Calendário principal identificado:', calendarId);
      console.log('📋 [GOOGLE CALENDAR] Nome do calendário:', primaryCalendar.summary);
      
      return calendarId;
    } else {
      console.log('⚠️ [GOOGLE CALENDAR] Nenhum calendário encontrado, usando "primary" como padrão');
      return 'primary';
    }
  } catch (error) {
    console.error('❌ [GOOGLE CALENDAR] Erro ao buscar calendário principal:', error);
    // Em caso de erro, retornar 'primary' como fallback
    return 'primary';
  }
}

module.exports = {
  getCalendarClientForUser,
  getEvents,
  formatEvent,
  getPrimaryCalendarId,
  getCalendarsList
};
