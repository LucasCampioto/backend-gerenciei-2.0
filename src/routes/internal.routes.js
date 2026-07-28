const express = require('express');
const router = express.Router();
const { authenticateService } = require('../middleware/serviceAuth.middleware');
const {
  getClientContext,
  listProcedures,
  listSalesSignals,
  upsertCommercialAction,
  logInternalActivity,
} = require('../controllers/internalTools.controller');

router.use(authenticateService);

router.get('/clients/:clientId/context', getClientContext);
router.get('/procedures', listProcedures);
router.get('/sales-signals', listSalesSignals);
router.post('/commercial-actions', upsertCommercialAction);
router.post('/activities', logInternalActivity);

module.exports = router;
