const express = require('express');
const router = express.Router();
const {
  getAllProcedures,
  createProcedure,
  updateProcedure,
  deleteProcedure
} = require('../controllers/procedure.controller');
const { validate } = require('../middleware/validation.middleware');
const { authenticate } = require('../middleware/auth.middleware');
const { procedureSchema } = require('../validators/procedure.validator');

router.use(authenticate);

router.get('/', getAllProcedures);
router.post('/', validate(procedureSchema), createProcedure);
router.put('/:id', validate(procedureSchema), updateProcedure);
router.delete('/:id', deleteProcedure);

module.exports = router;

