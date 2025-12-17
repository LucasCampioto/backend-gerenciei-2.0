const { S3Client } = require('@aws-sdk/client-s3');

// Configurar cliente S3
const s3Client = new S3Client({
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
  }
});

// Nome do bucket
const BUCKET_NAME = process.env.AWS_BUCKET_NAME || 'gerenciei-documentos';

// URL base do S3 (para construção de URLs públicas)
function getS3Url(key) {
  const region = process.env.AWS_REGION || 'us-east-1';
  return `https://${BUCKET_NAME}.s3.${region}.amazonaws.com/${key}`;
}

module.exports = {
  s3Client,
  BUCKET_NAME,
  getS3Url
};



