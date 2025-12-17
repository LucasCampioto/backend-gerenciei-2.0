const { getEvents, getCalendarsList } = require('../services/googleCalendar.service');
const User = require('../models/User');

async function getCalendarEvents(req, res, next) {
  try {
    const userId = req.userId; // Do middleware authenticate
    
    console.log('📅 [CALENDAR] Requisição recebida para buscar eventos do usuário:', userId);
    const { startDate, endDate, maxResults, calendarId: calendarIdFromQuery, maxEventsPerDay } = req.query;
    console.log('📅 [CALENDAR] Query params recebidos (RAW):', req.query);
    
    // Definir calendarId: prioridade para query string, depois banco, depois 'primary'
    let calendarId;
    if (calendarIdFromQuery && calendarIdFromQuery.trim() !== '') {
      calendarId = calendarIdFromQuery.trim();
      console.log('📅 [CALENDAR] Calendar ID da query string:', calendarId);
    } else {
      // Buscar calendarId salvo no banco
      const user = await User.findById(userId).select('googleCalendarId');
      if (user && user.googleCalendarId) {
        calendarId = user.googleCalendarId;
        console.log('📅 [CALENDAR] Calendar ID do banco de dados:', calendarId);
      } else {
        calendarId = 'primary';
        console.log('📅 [CALENDAR] Calendar ID padrão (primary)');
      }
    }
    
    console.log('📅 [CALENDAR] Query params extraídos:', { startDate, endDate, maxResults, calendarId, maxEventsPerDay });
    console.log('📅 [CALENDAR] Calendar ID final:', calendarId, '(vindo da query:', calendarIdFromQuery !== undefined ? calendarIdFromQuery : 'não fornecido', ')');
    
    const options = {
      calendarId: calendarId,
      maxResults: maxResults ? parseInt(maxResults, 10) : 50
    };
    console.log('📅 [CALENDAR] Opções iniciais (com calendarId):', options);

    // Validar datas
    if (startDate) {
      const start = new Date(startDate);
      if (isNaN(start.getTime())) {
        return res.status(400).json({
          success: false,
          error: 'Data inicial inválida. Use formato ISO (ex: 2024-01-01T00:00:00Z)'
        });
      }
      options.timeMin = start.toISOString();
    } else {
      // Se não fornecido, usar data atual
      options.timeMin = new Date().toISOString();
    }
    console.log('📅 [CALENDAR] timeMin:', options.timeMin);

    if (endDate) {
      const end = new Date(endDate);
      if (isNaN(end.getTime())) {
        return res.status(400).json({
          success: false,
          error: 'Data final inválida. Use formato ISO (ex: 2024-01-31T23:59:59Z)'
        });
      }
      options.timeMax = end.toISOString();
    }
    console.log('📅 [CALENDAR] timeMax:', options.timeMax);

    // Validar maxResults
    if (options.maxResults < 1 || options.maxResults > 2500) {
      return res.status(400).json({
        success: false,
        error: 'maxResults deve ser entre 1 e 2500'
      });
    }

    // Buscar eventos (passando userId como primeiro parâmetro)
    console.log('📅 [CALENDAR] Opções finais antes de buscar eventos (verificando calendarId):', {
      ...options,
      calendarId: options.calendarId // Garantir que está presente
    });
    const events = await getEvents(userId, options);
    console.log('📅 [CALENDAR] Eventos retornados:', events.length, 'eventos');
    console.log('📅 [CALENDAR] Primeiro evento (se houver):', events[0] || 'Nenhum evento');
    
    // Log de debug adicional
    if (events.length === 0) {
      console.log('⚠️ [CALENDAR] Nenhum evento retornado. Verifique:');
      console.log('  - Usuário conectou Google Calendar?');
      console.log('  - Calendar ID está correto?', options.calendarId);
      console.log('  - Período de busca está correto?', { timeMin: options.timeMin, timeMax: options.timeMax });
    }

    // Agrupar eventos por data para facilitar visualização nos cards
    const eventsByDate = {};
    const maxPerDay = maxEventsPerDay ? parseInt(maxEventsPerDay, 10) : null;
    
    events.forEach(event => {
      if (event.start) {
        const eventDate = new Date(event.start);
        const dateKey = eventDate.toISOString().split('T')[0]; // YYYY-MM-DD
        
        if (!eventsByDate[dateKey]) {
          eventsByDate[dateKey] = [];
        }
        
        // Limitar eventos por dia se especificado (para não expandir demais os cards)
        if (!maxPerDay || eventsByDate[dateKey].length < maxPerDay) {
          eventsByDate[dateKey].push(event);
        }
      }
    });

    // Ordenar eventos dentro de cada data por horário de início
    Object.keys(eventsByDate).forEach(date => {
      eventsByDate[date].sort((a, b) => {
        const timeA = new Date(a.start).getTime();
        const timeB = new Date(b.start).getTime();
        return timeA - timeB;
      });
    });

    res.json({
      success: true,
      data: events,
      groupedByDate: eventsByDate,
      totalEvents: events.length,
      totalDays: Object.keys(eventsByDate).length,
      calendarId: calendarId // Retornar o calendarId usado na busca
    });
  } catch (error) {
    // Tratar erros específicos
    if (error.message.includes('não conectou') || error.message.includes('Conecte sua conta')) {
      return res.status(403).json({
        success: false,
        error: error.message,
        code: 'CALENDAR_NOT_CONNECTED'
      });
    }

    if (error.message.includes('Credenciais') || error.message.includes('expiradas') || error.message.includes('inválido')) {
      return res.status(401).json({
        success: false,
        error: error.message,
        code: 'CALENDAR_AUTH_ERROR'
      });
    }

    if (error.message.includes('Sem permissões')) {
      return res.status(403).json({
        success: false,
        error: error.message,
        code: 'CALENDAR_PERMISSION_ERROR'
      });
    }

    if (error.message.includes('não encontrado')) {
      return res.status(404).json({
        success: false,
        error: error.message,
        code: 'CALENDAR_NOT_FOUND'
      });
    }

    // Erro genérico
    next(error);
  }
}

// Listar calendários disponíveis do usuário
async function getCalendars(req, res, next) {
  try {
    const userId = req.userId; // Do middleware authenticate
    
    console.log('📋 [CALENDAR] Requisição para listar calendários do usuário:', userId);
    
    // Buscar lista de calendários
    const calendars = await getCalendarsList(userId);
    
    console.log('📋 [CALENDAR] Total de calendários retornados:', calendars.length);
    
    res.json({
      success: true,
      data: calendars,
      total: calendars.length
    });
  } catch (error) {
    // Tratar erros específicos
    if (error.message.includes('não conectou') || error.message.includes('Conecte sua conta')) {
      return res.status(403).json({
        success: false,
        error: error.message,
        code: 'CALENDAR_NOT_CONNECTED'
      });
    }

    if (error.message.includes('Credenciais') || error.message.includes('expiradas') || error.message.includes('inválido')) {
      return res.status(401).json({
        success: false,
        error: error.message,
        code: 'CALENDAR_AUTH_ERROR'
      });
    }

    // Erro genérico
    next(error);
  }
}

module.exports = {
  getCalendarEvents,
  getCalendars
};


