const express = require('express');
const router = express.Router();
const { getAnnualBalance } = require('../controllers/annualBalance.controller');
const { authenticate } = require('../middleware/auth.middleware');

router.use(authenticate);

router.get('/annual-balance', getAnnualBalance);

module.exports = router;
