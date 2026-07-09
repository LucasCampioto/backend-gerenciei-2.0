const express = require('express');
const router = express.Router();
const {
  getAllForms,
  getFormById,
  createForm,
  updateForm,
  deleteForm,
} = require('../controllers/form.controller');
const {
  getFormResponses,
  getFormAnalytics,
} = require('../controllers/formAnalytics.controller');
const { validate } = require('../middleware/validation.middleware');
const { authenticate } = require('../middleware/auth.middleware');
const { formSchema } = require('../validators/form.validator');

router.use(authenticate);

router.get('/', getAllForms);
router.post('/', validate(formSchema), createForm);
router.get('/:id/responses', getFormResponses);
router.get('/:id/analytics', getFormAnalytics);
router.get('/:id', getFormById);
router.put('/:id', validate(formSchema), updateForm);
router.delete('/:id', deleteForm);

module.exports = router;
