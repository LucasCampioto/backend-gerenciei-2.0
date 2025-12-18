const multer = require('multer');
const path = require('path');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { BUCKET_NAME, isS3Available, getS3Url, hasAwsCredentials } = require('../config/s3');

// Configurar filtro de tipos de arquivo permitidos
const fileFilter = (req, file, cb) => {
  const allowedTypes = ['application/pdf', 'image/png', 'image/jpeg', 'image/jpg'];
  
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Tipo de arquivo não permitido. Apenas PDF e imagens são aceitos.'), false);
  }
};

// Storage customizado para AWS SDK v3
const s3Storage = {
  _handleFile: function (req, file, cb) {
    // Gerar nome único para o arquivo
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    const fileName = `documents/${uniqueSuffix}${ext}`;
    
    // Ler o buffer do arquivo (igual ao teste que funcionou)
    const chunks = [];
    
    file.stream.on('data', (chunk) => {
      chunks.push(chunk);
    });
    
    file.stream.on('end', async () => {
      try {
        // Criar buffer exatamente como no teste
        const buffer = Buffer.concat(chunks);
        
        console.log('📤 Iniciando upload para S3:', {
          bucket: BUCKET_NAME,
          key: fileName,
          size: buffer.length,
          contentType: file.mimetype,
          bufferType: buffer.constructor.name
        });
        
        // Criar cliente S3 novo (igual ao teste que funcionou)
        // Isso garante que não há problema com cliente compartilhado
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
        
        // Usar exatamente o mesmo formato do teste que funcionou
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
        
        // Construir URL pública do arquivo
        const fileUrl = getS3Url(fileName);
        
        // Retornar informações do arquivo no formato esperado pelo multer
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
    // Não precisa fazer nada aqui, o delete é feito no controller
    cb(null);
  }
};

// Verificar se S3 está disponível antes de configurar
if (!isS3Available()) {
  console.warn('⚠️ S3 não disponível. Upload de arquivos desabilitado.');
}

// Configurar storage do Multer (S3 se disponível, senão local)
const storage = isS3Available() ? s3Storage : multer.diskStorage({
  // Fallback para armazenamento local se S3 não estiver disponível
  destination: function (req, file, cb) {
    cb(null, 'uploads/documents/');
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    cb(null, `${uniqueSuffix}${ext}`);
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB
  },
  fileFilter: fileFilter
});

module.exports = upload;
