const express = require('express');
const router = express.Router();
const {
  getAllEmployees,
  createEmployee,
  updateEmployee,
  deleteEmployee,
  getEmployeeCommission
} = require('../controllers/employee.controller');
const { validate } = require('../middleware/validation.middleware');
const { authenticate } = require('../middleware/auth.middleware');
const { employeeSchema } = require('../validators/employee.validator');

router.use(authenticate);

router.get('/', getAllEmployees);
router.post('/', validate(employeeSchema), createEmployee);
router.put('/:id', validate(employeeSchema), updateEmployee);
router.delete('/:id', deleteEmployee);
router.get('/:id/commission/:procedureId', getEmployeeCommission);

module.exports = router;

