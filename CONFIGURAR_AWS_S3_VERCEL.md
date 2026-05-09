# Como Configurar AWS S3 na Vercel

## Erro Atual

O erro `SignatureDoesNotMatch` indica que as credenciais AWS não estão configuradas corretamente na Vercel.

## Solução

### 1. Verificar se você tem credenciais AWS

Você precisa de:
- **AWS_ACCESS_KEY_ID**: Chave de acesso AWS
- **AWS_SECRET_ACCESS_KEY**: Chave secreta AWS
- **AWS_REGION**: Região do bucket (ex: `us-east-1`, `sa-east-1`)
- **AWS_BUCKET_NAME**: Nome do bucket S3

### 2. Adicionar variáveis na Vercel

#### Via Dashboard (Recomendado):

1. Acesse [Vercel Dashboard](https://vercel.com/dashboard)
2. Selecione seu projeto **backend**
3. Vá em **Settings** → **Environment Variables**
4. Adicione cada variável:

   ```
   AWS_ACCESS_KEY_ID=sua_access_key_aqui
   AWS_SECRET_ACCESS_KEY=sua_secret_key_aqui
   AWS_REGION=us-east-1
   AWS_BUCKET_NAME=gerenciei-documentos
   ```

5. **IMPORTANTE**: Marque ✅ Production, ✅ Preview, ✅ Development
6. Clique em **Save**

#### Via CLI:

```bash
vercel env add AWS_ACCESS_KEY_ID production
vercel env add AWS_SECRET_ACCESS_KEY production
vercel env add AWS_REGION production
vercel env add AWS_BUCKET_NAME production
```

### 3. Verificar credenciais

Certifique-se de que:
- ✅ As credenciais estão corretas (sem espaços extras)
- ✅ A região está correta (deve ser a mesma do bucket)
- ✅ O bucket existe e está acessível
- ✅ O usuário IAM tem permissões para PutObject, GetObject, DeleteObject

### 4. Se não usar S3

Se você **não quiser usar S3** por enquanto, o código agora tem fallback:
- Se as credenciais não estiverem configuradas, os arquivos serão salvos localmente em `uploads/documents/`
- O erro não vai mais quebrar a aplicação

### 5. Após configurar

1. Faça um novo deploy ou aguarde o próximo
2. Teste o upload de documentos
3. Verifique os logs - você deve ver: `✅ AWS S3 client configurado`

## Verificar se está funcionando

Após configurar, nos logs você verá:
- ✅ `AWS S3 client configurado` - S3 está funcionando
- ⚠️ `Credenciais AWS não configuradas` - S3 não está configurado (usa fallback local)

## Erros comuns

### "SignatureDoesNotMatch"
- Credenciais incorretas
- Região incorreta
- Chaves expiradas ou inválidas

### "Access Denied"
- Usuário IAM não tem permissões
- Bucket não existe ou está em outra região

### "Bucket not found"
- Nome do bucket incorreto
- Bucket está em outra região

