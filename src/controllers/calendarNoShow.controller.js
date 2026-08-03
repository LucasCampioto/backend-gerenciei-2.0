const noShowService = require('../services/calendarNoShow.service');

function httpError(res, error) {
  const status = error.statusCode || 500;
  return res.status(status).json({
    success: false,
    error: error.message || 'Erro interno',
    code: error.code,
  });
}

async function markNoShow(req, res) {
  try {
    const data = await noShowService.markNoShow(req.userId, {
      calendarEventId: req.body?.calendarEventId || req.params?.eventId,
      eventStart: req.body?.eventStart,
      eventTitle: req.body?.eventTitle || req.body?.summary,
      summary: req.body?.summary,
    });
    return res.json({ success: true, data });
  } catch (error) {
    return httpError(res, error);
  }
}

async function unmarkNoShow(req, res) {
  try {
    const eventId = req.params?.eventId || req.body?.calendarEventId;
    const data = await noShowService.unmarkNoShow(req.userId, eventId);
    return res.json({ success: true, data });
  } catch (error) {
    return httpError(res, error);
  }
}

async function listNoShows(req, res) {
  try {
    let eventIds;
    if (typeof req.query?.eventIds === 'string' && req.query.eventIds.trim()) {
      eventIds = req.query.eventIds.split(',').map((s) => s.trim()).filter(Boolean);
    }
    const data = await noShowService.listNoShows(req.userId, {
      eventIds,
      from: req.query?.from,
      to: req.query?.to,
    });
    return res.json({ success: true, data });
  } catch (error) {
    return httpError(res, error);
  }
}

module.exports = {
  markNoShow,
  unmarkNoShow,
  listNoShows,
};
