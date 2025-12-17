const express = require('express');
const router = express.Router();
const {
  getAllDocuments,
  createDocument,
  downloadDocument,
  deleteDocument
} = require('../controllers/document.controller');
const { validate } = require('../middleware/validation.middleware');
const { authenticate } = require('../middleware/auth.middleware');
const { documentSchema } = require('../validators/document.validator');
const upload = require('../utils/upload');

router.use(authenticate);

router.get('/', getAllDocuments);
router.post('/', 
  upload.single('file'), 
  (req, res, next) => {
    // Se houver arquivo, adicionar informações ao body para validação
    if (req.file) {
      req.body.fileType = req.body.fileType || req.file.mimetype;
      req.body.fileName = req.body.fileName || req.file.originalname;
      // Se houver arquivo, não requerer fileUrl
      req.body.hasFile = true;
    }
    next();
  }, 
  validate(documentSchema), 
  createDocument
);
router.get('/:id/download', downloadDocument);
router.delete('/:id', deleteDocument);

module.exports = router;

