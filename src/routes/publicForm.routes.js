const express = require('express');
const router = express.Router();
const {
  getPublicForm,
  submitPublicResponse,
} = require('../controllers/publicForm.controller');
const { validate } = require('../middleware/validation.middleware');
const { publicResponseSchema } = require('../validators/form.validator');

router.get('/:slug', getPublicForm);
router.post('/:slug/responses', validate(publicResponseSchema), submitPublicResponse);

module.exports = router;
