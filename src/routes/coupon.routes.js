const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth.middleware');
const { validate } = require('../middleware/validation.middleware');
const { couponSchema, couponUpdateSchema } = require('../validators/coupon.validator');
const { list, getOne, create, update } = require('../controllers/coupon.controller');

router.use(authenticate);

router.get('/', list);
router.post('/', validate(couponSchema), create);
router.get('/:id', getOne);
router.put('/:id', validate(couponUpdateSchema), update);

module.exports = router;
