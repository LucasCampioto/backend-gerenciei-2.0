const express = require('express');
const router = express.Router();
const { getCalendarEvents, getCalendars } = require('../controllers/calendar.controller');
const { 
  initiateOAuth, 
  handleOAuthCallback, 
  disconnectCalendar, 
  getConnectionStatus 
} = require('../controllers/calendarOAuth.controller');
const { authenticate } = require('../middleware/auth.middleware');

// Rotas OAuth (callback não precisa de autenticação, mas valida state)
router.get('/oauth/callback', handleOAuthCallback);

// Todas as outras rotas requerem autenticação JWT
router.use(authenticate);

// Rotas OAuth
router.get('/oauth/initiate', initiateOAuth);
router.get('/oauth/status', getConnectionStatus);
router.post('/oauth/disconnect', disconnectCalendar);

// Rota para listar calendários disponíveis
router.get('/calendars', getCalendars);

// Rota para buscar eventos/agendamentos
router.get('/events', getCalendarEvents);

module.exports = router;




