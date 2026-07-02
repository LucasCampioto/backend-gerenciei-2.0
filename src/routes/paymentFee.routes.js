const express = require('express');
const router = express.Router();
const {
  getAllPaymentFees,
  updatePaymentFees,
} = require('../controllers/paymentFee.controller');
const { authenticate } = require('../middleware/auth.middleware');

router.use(authenticate);

router.get('/', getAllPaymentFees);
router.put('/', updatePaymentFees);

module.exports = router;
