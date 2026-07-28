const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth.middleware');
const { validate } = require('../middleware/validation.middleware');
const {
  listCommercialActions,
  patchCommercialAction,
  completeCommercialAction,
  snoozeCommercialAction,
  dismissCommercialAction,
  feedbackCommercialAction,
  getCommercialAction,
} = require('../controllers/commercialAction.controller');
const {
  qualify,
  offer,
  objection,
  conversation,
  approveJourney,
  advanceJourney,
  moveJourney,
  closingQueue,
  director,
  prepareLead,
  getContext,
  agnoStatus,
  learning,
  reactivationTargets,
  reactivationGenerate,
  reactivationContacted,
} = require('../controllers/intelligence.controller');
const {
  patchCommercialActionSchema,
  completeCommercialActionSchema,
  snoozeCommercialActionSchema,
  feedbackCommercialActionSchema,
  objectionSchema,
  qualifySchema,
} = require('../validators/commercial.validator');

router.use(authenticate);

router.get('/actions', listCommercialActions);
router.get('/actions/:id', getCommercialAction);
router.patch('/actions/:id', validate(patchCommercialActionSchema), patchCommercialAction);
router.post('/actions/:id/complete', validate(completeCommercialActionSchema), completeCommercialAction);
router.post('/actions/:id/snooze', validate(snoozeCommercialActionSchema), snoozeCommercialAction);
router.post('/actions/:id/dismiss', dismissCommercialAction);
router.post('/actions/:id/feedback', validate(feedbackCommercialActionSchema), feedbackCommercialAction);

router.get('/closing-queue', closingQueue);
router.get('/agno-status', agnoStatus);
router.get('/learning', learning);
router.get('/clients/:clientId/context', getContext);
router.post('/clients/:clientId/qualify', validate(qualifySchema), qualify);
router.post('/clients/:clientId/offer', offer);
router.post('/clients/:clientId/objection', validate(objectionSchema), objection);
router.post('/clients/:clientId/conversation', conversation);
router.post('/clients/:clientId/journey/approve', approveJourney);
router.post('/clients/:clientId/journey/advance', advanceJourney);
router.post('/clients/:clientId/journey/move', moveJourney);
router.post('/clients/:clientId/prepare', prepareLead);
router.post('/director', director);
router.get('/reactivation/targets', reactivationTargets);
router.post('/reactivation/generate', reactivationGenerate);
router.post('/reactivation/:clientId/contacted', reactivationContacted);

module.exports = router;
