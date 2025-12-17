const express = require('express');
const router = express.Router();
const {
  getAllSales,
  createSale,
  deleteSale,
  getSalesByEmployee,
  getEmployeeSalesTotal
} = require('../controllers/sale.controller');
const { validate } = require('../middleware/validation.middleware');
const { authenticate } = require('../middleware/auth.middleware');
const { saleSchema } = require('../validators/sale.validator');

router.use(authenticate);

router.get('/', getAllSales);
router.post('/', validate(saleSchema), createSale);
router.delete('/:id', deleteSale);
router.get('/employee/:employeeId', getSalesByEmployee);
router.get('/employee/:employeeId/total', getEmployeeSalesTotal);

module.exports = router;

