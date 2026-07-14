const express = require('express');
const router = express.Router();
const {
  getCrmClients,
  getCrmDashboard,
  getClientHistory,
  updateCrmClient,
  addCrmAction,
  deleteCrmActivity,
  getActionQueue,
  getDueReturnsHandler,
  getClientJourney,
} = require('../controllers/crm.controller');
const { validate } = require('../middleware/validation.middleware');
const { authenticate } = require('../middleware/auth.middleware');
const {
  updateCrmClientSchema,
  addCrmActionSchema,
} = require('../validators/crm.validator');

router.use(authenticate);

router.get('/clients', getCrmClients);
router.get('/dashboard', getCrmDashboard);
router.get('/action-queue', getActionQueue);
router.get('/due-returns', getDueReturnsHandler);
router.get('/clients/:id/history', getClientHistory);
router.get('/clients/:id/journey', getClientJourney);
router.patch('/clients/:id', validate(updateCrmClientSchema), updateCrmClient);
router.post('/clients/:id/actions', validate(addCrmActionSchema), addCrmAction);
router.delete('/activities/:activityId', deleteCrmActivity);

module.exports = router;
