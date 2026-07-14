const express = require('express');
const router = express.Router();
const { bootstrapOnboarding, getOnboardingStatus } = require('../controllers/onboarding.controller');
const { authenticate } = require('../middleware/auth.middleware');

router.use(authenticate);

router.get('/status', getOnboardingStatus);
router.post('/bootstrap', bootstrapOnboarding);

module.exports = router;
