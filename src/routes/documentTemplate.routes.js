const express = require('express');
const router = express.Router();
const {
  getAllTemplates,
  createTemplate,
  updateTemplate,
  downloadTemplate,
  deleteTemplate,
} = require('../controllers/documentTemplate.controller');
const { validate } = require('../middleware/validation.middleware');
const { authenticate } = require('../middleware/auth.middleware');
const { requirePermission } = require('../middleware/orgAuth.middleware');
const { documentTemplateSchema, documentTemplateUpdateSchema } = require('../validators/documentTemplate.validator');
const { createUpload } = require('../utils/upload');

const upload = createUpload('templates');

router.use(authenticate);
router.use(requirePermission('gestao.assinaturas'));

router.get('/', getAllTemplates);
router.post(
  '/',
  upload.single('file'),
  (req, res, next) => {
    if (req.file) {
      req.body.fileType = req.body.fileType || req.file.mimetype;
      req.body.fileName = req.body.fileName || req.file.originalname;
    }
    next();
  },
  validate(documentTemplateSchema),
  createTemplate
);
router.put(
  '/:id',
  upload.single('file'),
  (req, res, next) => {
    if (req.file) {
      req.body.fileType = req.body.fileType || req.file.mimetype;
      req.body.fileName = req.body.fileName || req.file.originalname;
    }
    next();
  },
  validate(documentTemplateUpdateSchema),
  updateTemplate
);
router.get('/:id/file', downloadTemplate);
router.delete('/:id', deleteTemplate);

module.exports = router;
