require('dotenv').config();
const { S3Client, PutObjectCommand, ListBucketsCommand } = require('@aws-sdk/client-s3');

async function testS3() {
  try {
    console.log('🔍 Testando credenciais AWS S3...\n');
    
    // Verificar variáveis
    const accessKeyId = process.env.AWS_ACCESS_KEY_ID?.trim();
    const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY?.trim();
    const region = process.env.AWS_REGION?.trim() || 'us-east-1';
    const bucketName = process.env.AWS_BUCKET_NAME?.trim() || 'gerenciei-documentos';
    
    console.log('Variáveis de ambiente:');
    console.log('  AWS_ACCESS_KEY_ID:', accessKeyId ? `${accessKeyId.substring(0, 4)}...` : 'NÃO DEFINIDO');
    console.log('  AWS_SECRET_ACCESS_KEY:', secretAccessKey ? '***' : 'NÃO DEFINIDO');
    console.log('  AWS_REGION:', region);
    console.log('  AWS_BUCKET_NAME:', bucketName);
    console.log('');
    
    if (!accessKeyId || !secretAccessKey) {
      console.error('❌ Credenciais não configuradas!');
      process.exit(1);
    }
    
    // Criar cliente
    const s3Client = new S3Client({
      region: region,
      credentials: {
        accessKeyId: accessKeyId,
        secretAccessKey: secretAccessKey
      }
    });
    
    console.log('✅ Cliente S3 criado\n');
    
    // Teste 1: Listar buckets (verifica credenciais básicas)
    console.log('📋 Teste 1: Listando buckets...');
    try {
      const listCommand = new ListBucketsCommand({});
      const response = await s3Client.send(listCommand);
      console.log('✅ Credenciais válidas!');
      console.log('Buckets encontrados:', response.Buckets?.map(b => b.Name).join(', ') || 'Nenhum');
      console.log('');
    } catch (error) {
      console.error('❌ Erro ao listar buckets:', error.message);
      console.error('Código:', error.Code || error.code);
      console.error('Nome:', error.name);
      throw error;
    }
    
    // Teste 2: Upload de teste
    console.log('📤 Teste 2: Fazendo upload de teste...');
    try {
      const testContent = Buffer.from('Teste de upload S3 - ' + new Date().toISOString());
      const testKey = `test/${Date.now()}-test.txt`;
      
      const putCommand = new PutObjectCommand({
        Bucket: bucketName,
        Key: testKey,
        Body: testContent,
        ContentType: 'text/plain'
      });
      
      const response = await s3Client.send(putCommand);
      console.log('✅ Upload de teste bem-sucedido!');
      console.log('Key:', testKey);
      console.log('ETag:', response.ETag);
      console.log('');
    } catch (error) {
      console.error('❌ Erro no upload de teste:', error.message);
      console.error('Código:', error.Code || error.code);
      console.error('Nome:', error.name);
      if (error.Code === 'SignatureDoesNotMatch') {
        console.error('\n💡 Possíveis causas:');
        console.error('  1. Credenciais incorretas');
        console.error('  2. Região incorreta (bucket pode estar em outra região)');
        console.error('  3. Credenciais com espaços extras ou caracteres especiais');
        console.error('  4. Relógio do sistema desincronizado');
      }
      throw error;
    }
    
    console.log('✅ Todos os testes passaram!');
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Teste falhou:', error.message);
    process.exit(1);
  }
}

testS3();

