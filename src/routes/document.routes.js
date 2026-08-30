const express = require('express');
const router = express.Router();
const {
  getAllDocuments,
  createDocument,
  updateDocument,
  downloadDocument,
  deleteDocument
} = require('../controllers/document.controller');
const { validate } = require('../middleware/validation.middleware');
const { authenticate } = require('../middleware/auth.middleware');
const { requirePermission, requireAnyPermission } = require('../middleware/orgAuth.middleware');
const { documentSchema, documentUpdateSchema } = require('../validators/document.validator');
const upload = require('../utils/upload');

router.use(authenticate);

router.get('/', requirePermission('gestao.documentos'), getAllDocuments);
router.post('/',
  requireAnyPermission('gestao.documentos', 'gestao.assinaturas'),
  upload.single('file'), 
  (req, res, next) => {
    if (req.file) {
      req.body.fileType = req.body.fileType || req.file.mimetype;
      req.body.fileName = req.body.fileName || req.file.originalname;
      req.body.hasFile = true;
    }
    next();
  }, 
  validate(documentSchema), 
  createDocument
);
router.patch(
  '/:id',
  requirePermission('gestao.documentos'),
  validate(documentUpdateSchema),
  updateDocument
);
router.get('/:id/download', requireAnyPermission('gestao.documentos', 'gestao.assinaturas'), downloadDocument);
router.delete('/:id', requirePermission('gestao.documentos'), deleteDocument);

module.exports = router;
