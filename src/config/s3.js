const { S3Client } = require('@aws-sdk/client-s3');

// Verificar se as credenciais AWS estão configuradas
const hasAwsCredentials = 
  process.env.AWS_ACCESS_KEY_ID && 
  process.env.AWS_SECRET_ACCESS_KEY && 
  process.env.AWS_REGION;

// Nome do bucket
const BUCKET_NAME = process.env.AWS_BUCKET_NAME || 'gerenciei-documentos';
const AWS_REGION = process.env.AWS_REGION || 'us-east-1';

// Criar cliente S3 apenas se as credenciais estiverem configuradas
let s3Client = null;

if (hasAwsCredentials) {
  try {
    // Limpar espaços das credenciais (caso tenham espaços extras)
    const accessKeyId = process.env.AWS_ACCESS_KEY_ID.trim();
    const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY.trim();
    const region = AWS_REGION.trim();
    
    console.log('🔧 Configurando S3 Client:', {
      region: region,
      hasAccessKey: !!accessKeyId,
      hasSecretKey: !!secretAccessKey,
      bucket: BUCKET_NAME
    });
    
    s3Client = new S3Client({
      region: region,
      credentials: {
        accessKeyId: accessKeyId,
        secretAccessKey: secretAccessKey
      }
    });
    console.log('✅ AWS S3 client configurado');
  } catch (error) {
    console.error('❌ Erro ao configurar cliente S3:', error.message);
    console.error('Stack:', error.stack);
    s3Client = null;
  }
} else {
  console.warn('⚠️ Credenciais AWS não configuradas. Upload para S3 desabilitado.');
  console.warn('Variáveis necessárias:', {
    AWS_ACCESS_KEY_ID: !!process.env.AWS_ACCESS_KEY_ID,
    AWS_SECRET_ACCESS_KEY: !!process.env.AWS_SECRET_ACCESS_KEY,
    AWS_REGION: !!process.env.AWS_REGION
  });
}

// URL base do S3 (para construção de URLs públicas)
function getS3Url(key) {
  return `https://${BUCKET_NAME}.s3.${AWS_REGION}.amazonaws.com/${key}`;
}

// Função para verificar se S3 está disponível
function isS3Available() {
  return s3Client !== null && hasAwsCredentials;
}

module.exports = {
  s3Client,
  BUCKET_NAME,
  getS3Url,
  isS3Available,
  hasAwsCredentials
};



