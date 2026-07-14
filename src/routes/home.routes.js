const express = require('express');
const router = express.Router();
const { getDailyHome } = require('../controllers/home.controller');
const { authenticate } = require('../middleware/auth.middleware');

router.use(authenticate);

router.get('/daily', getDailyHome);

module.exports = router;
