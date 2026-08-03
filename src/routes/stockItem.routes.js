const express = require('express');
const router = express.Router();
const {
  getAllStockItems,
  createStockItem,
  updateStockItem,
  deleteStockItem,
} = require('../controllers/stockItem.controller');
const { validate } = require('../middleware/validation.middleware');
const { authenticate } = require('../middleware/auth.middleware');
const { stockItemSchema } = require('../validators/stockItem.validator');

router.use(authenticate);

router.get('/', getAllStockItems);
router.post('/', validate(stockItemSchema), createStockItem);
router.put('/:id', validate(stockItemSchema), updateStockItem);
router.delete('/:id', deleteStockItem);

module.exports = router;
