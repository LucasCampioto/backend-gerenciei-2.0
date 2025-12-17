const multer = require('multer');
const multerS3 = require('multer-s3');
const path = require('path');
const { s3Client, BUCKET_NAME } = require('../config/s3');

// Configurar filtro de tipos de arquivo permitidos
const fileFilter = (req, file, cb) => {
  const allowedTypes = ['application/pdf', 'image/png', 'image/jpeg', 'image/jpg'];
  
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Tipo de arquivo não permitido. Apenas PDF e imagens são aceitos.'), false);
  }
};

// Configurar storage do Multer para S3
const storage = multerS3({
  s3: s3Client,
  bucket: BUCKET_NAME,
  // Removido acl porque o bucket não permite ACLs
  // Use Bucket Policy para tornar os objetos públicos
  metadata: function (req, file, cb) {
    cb(null, {
      fieldName: file.fieldname,
      uploadedBy: req.userId?.toString() || 'unknown',
      originalName: file.originalname
    });
  },
  key: function (req, file, cb) {
    // Gerar nome único para o arquivo
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    const fileName = `documents/${uniqueSuffix}${ext}`;
    cb(null, fileName);
  },
  contentType: multerS3.AUTO_CONTENT_TYPE // Detectar automaticamente o tipo de conteúdo
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB
  },
  fileFilter: fileFilter
});

module.exports = upload;
