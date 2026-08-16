const { isOrgAdminRequest } = require('../utils/tenantScope');
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

function parseRangeOptions(req) {
  const { startDate, endDate, maxResults } = req.query;
  const options = {
    maxResults: maxResults ? parseInt(maxResults, 10) : 100,
  };

  if (startDate) {
    const start = new Date(startDate);
    if (isNaN(start.getTime())) {
      const err = new Error('Data inicial inválida. Use formato ISO (ex: 2024-01-01T00:00:00Z)');
      err.status = 400;
      throw err;
    }
    options.timeMin = start.toISOString();
  } else {
    options.timeMin = new Date().toISOString();
  }

  if (endDate) {
    const end = new Date(endDate);
    if (isNaN(end.getTime())) {
      const err = new Error('Data final inválida. Use formato ISO (ex: 2024-01-31T23:59:59Z)');
      err.status = 400;
      throw err;
    }
    options.timeMax = end.toISOString();
  }

  if (options.maxResults < 1 || options.maxResults > 2500) {
    const err = new Error('maxResults deve ser entre 1 e 2500');
    err.status = 400;
    throw err;
  }

  return options;
}

/**
 * Lista membros da org com status de Google Calendar (só admin/owner).
 */
async function getTeamCalendarMembers(req, res, next) {
  try {
    if (!isOrgAdminRequest(req)) {
      return res.status(403).json({
        success: false,
        error: 'Apenas administradores podem ver a agenda da equipe',
      });
    }

    if (!req.orgId) {
      const self = await User.findById(req.userId)
        .select('name email googleCalendarConnected googleCalendarId role status')
        .lean();
      return res.json({
        success: true,
        data: [
          {
            id: String(self._id),
            name: self.name,
            email: self.email,
            role: self.role || 'owner',
            connected: Boolean(self.googleCalendarConnected),
            calendarId: self.googleCalendarId || 'primary',
          },
        ],
      });
    }

    const members = await User.find({
      organizationId: req.orgId,
      status: { $ne: 'disabled' },
    })
      .select('name email googleCalendarConnected googleCalendarId role status')
      .sort({ role: 1, name: 1 })
      .lean();

    return res.json({
      success: true,
      data: members.map((m) => ({
        id: String(m._id),
        name: m.name,
        email: m.email,
        role: m.role || 'member',
        connected: Boolean(m.googleCalendarConnected),
        calendarId: m.googleCalendarId || 'primary',
      })),
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Agenda agregada da equipe (só admin/owner).
 * Query: startDate, endDate, memberUserId? (filtra um colaborador)
 */
async function getTeamCalendarEvents(req, res, next) {
  try {
    if (!isOrgAdminRequest(req)) {
      return res.status(403).json({
        success: false,
        error: 'Apenas administradores podem ver a agenda da equipe',
      });
    }

    let options;
    try {
      options = parseRangeOptions(req);
    } catch (err) {
      return res.status(err.status || 400).json({ success: false, error: err.message });
    }

    const memberFilter =
      typeof req.query.memberUserId === 'string' ? req.query.memberUserId.trim() : null;

    let membersQuery;
    if (!req.orgId) {
      membersQuery = User.find({ _id: req.userId }).select(
        'name email googleCalendarConnected googleCalendarId role status',
      );
    } else {
      membersQuery = User.find({
        organizationId: req.orgId,
        status: { $ne: 'disabled' },
      }).select('name email googleCalendarConnected googleCalendarId role status');
    }

    const members = await membersQuery.sort({ role: 1, name: 1 }).lean();
    const memberMeta = members.map((m) => ({
      id: String(m._id),
      name: m.name,
      email: m.email,
      role: m.role || 'member',
      connected: Boolean(m.googleCalendarConnected),
      calendarId: m.googleCalendarId || 'primary',
    }));

    let targets = members.filter((m) => m.googleCalendarConnected);
    if (memberFilter) {
      targets = targets.filter((m) => String(m._id) === memberFilter);
      if (targets.length === 0) {
        const exists = members.find((m) => String(m._id) === memberFilter);
        return res.json({
          success: true,
          data: [],
          members: memberMeta,
          totalEvents: 0,
          warnings: exists
            ? [
                {
                  memberUserId: memberFilter,
                  memberName: exists.name,
                  message: exists.googleCalendarConnected
                    ? 'Não foi possível carregar a agenda'
                    : 'Colaborador ainda não conectou o Google Calendar',
                },
              ]
            : [{ memberUserId: memberFilter, message: 'Membro não encontrado' }],
        });
      }
    }

    const warnings = [];
    const settled = await Promise.all(
      targets.map(async (member) => {
        const memberId = String(member._id);
        try {
          const events = await getEvents(member._id, {
            ...options,
            calendarId: member.googleCalendarId || 'primary',
          });
          return events.map((event) => ({
            ...event,
            id: `${memberId}:${event.id}`,
            sourceEventId: event.id,
            memberUserId: memberId,
            memberName: member.name,
            memberEmail: member.email,
          }));
        } catch (err) {
          warnings.push({
            memberUserId: memberId,
            memberName: member.name,
            message: err.message || 'Erro ao carregar agenda',
          });
          return [];
        }
      }),
    );

    const events = settled.flat().sort((a, b) => {
      const ta = a.start ? new Date(a.start).getTime() : 0;
      const tb = b.start ? new Date(b.start).getTime() : 0;
      return ta - tb;
    });

    return res.json({
      success: true,
      data: events,
      members: memberMeta,
      totalEvents: events.length,
      warnings,
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getCalendarEvents,
  getCalendars,
  getTeamCalendarMembers,
  getTeamCalendarEvents,
};


