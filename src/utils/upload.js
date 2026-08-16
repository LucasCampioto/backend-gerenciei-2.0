const multer = require('multer');
const path = require('path');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { BUCKET_NAME, isS3Available, getS3Url, hasAwsCredentials } = require('../config/s3');

const fileFilter = (req, file, cb) => {
  const allowedTypes = ['application/pdf', 'image/png', 'image/jpeg', 'image/jpg'];
  
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Tipo de arquivo não permitido. Apenas PDF e imagens são aceitos.'), false);
  }
};

function createS3Storage(keyPrefix) {
  const prefix = String(keyPrefix || 'documents').replace(/^\/+|\/+$/g, '');

  return {
    _handleFile: function (req, file, cb) {
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
      const ext = path.extname(file.originalname);
      const fileName = `${prefix}/${uniqueSuffix}${ext}`;
      
      const chunks = [];
      
      file.stream.on('data', (chunk) => {
        chunks.push(chunk);
      });
      
      file.stream.on('end', async () => {
        try {
          const buffer = Buffer.concat(chunks);
          
          console.log('📤 Iniciando upload para S3:', {
            bucket: BUCKET_NAME,
            key: fileName,
            size: buffer.length,
            contentType: file.mimetype,
            bufferType: buffer.constructor.name
          });
          
          const accessKeyId = process.env.AWS_ACCESS_KEY_ID?.trim();
          const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY?.trim();
          const region = process.env.AWS_REGION?.trim() || 'us-east-1';
          
          if (!accessKeyId || !secretAccessKey) {
            throw new Error('Credenciais AWS não configuradas');
          }
          
          const uploadClient = new S3Client({
            region: region,
            credentials: {
              accessKeyId: accessKeyId,
              secretAccessKey: secretAccessKey
            }
          });
          
          const command = new PutObjectCommand({
            Bucket: BUCKET_NAME,
            Key: fileName,
            Body: buffer,
            ContentType: file.mimetype || 'application/octet-stream'
          });
          
          console.log('📋 Command criado, enviando...');
          const response = await uploadClient.send(command);
          console.log('✅ Upload concluído:', {
            key: fileName,
            etag: response.ETag,
            versionId: response.VersionId
          });
          
          const fileUrl = getS3Url(fileName);
          
          cb(null, {
            location: fileUrl,
            bucket: BUCKET_NAME,
            key: fileName,
            etag: response.ETag || null,
            contentType: file.mimetype,
            mimetype: file.mimetype,
            originalname: file.originalname,
            fieldname: file.fieldname,
            size: buffer.length
          });
        } catch (error) {
          console.error('❌ Erro no upload para S3:', {
            message: error.message,
            code: error.Code || error.code,
            name: error.name,
            requestId: error.$metadata?.requestId,
            httpStatusCode: error.$metadata?.httpStatusCode,
            bucket: BUCKET_NAME,
            key: fileName
          });
          if (error.$metadata) {
            console.error('Metadata do erro:', error.$metadata);
          }
          console.error('Stack:', error.stack);
          cb(error);
        }
      });
      
      file.stream.on('error', (error) => {
        console.error('❌ Erro no stream do arquivo:', error);
        cb(error);
      });
    },
    
    _removeFile: function (req, file, cb) {
      cb(null);
    }
  };
}

if (!isS3Available()) {
  console.warn('⚠️ S3 não disponível. Upload de arquivos desabilitado.');
}

function createUpload(keyPrefix) {
  const prefix = String(keyPrefix || 'documents').replace(/^\/+|\/+$/g, '');
  const storage = isS3Available() ? createS3Storage(prefix) : multer.diskStorage({
    destination: function (req, file, cb) {
      cb(null, `uploads/${prefix}/`);
    },
    filename: function (req, file, cb) {
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
      const ext = path.extname(file.originalname);
      cb(null, `${uniqueSuffix}${ext}`);
    }
  });

  return multer({
    storage: storage,
    limits: {
      fileSize: 10 * 1024 * 1024
    },
    fileFilter: fileFilter
  });
}

const upload = createUpload('documents');

module.exports = upload;
module.exports.createUpload = createUpload;
