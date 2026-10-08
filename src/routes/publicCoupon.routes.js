const express = require('express');
const router = express.Router();
const { getOne } = require('../controllers/publicCoupon.controller');

router.get('/:slug', getOne);

module.exports = router;
