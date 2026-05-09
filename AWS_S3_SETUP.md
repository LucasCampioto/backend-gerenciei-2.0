# Configuração AWS S3 para Upload de Documentos

## 📋 Variáveis de Ambiente Necessárias

Adicione as seguintes variáveis no seu arquivo `.env`:

```env
# AWS S3 Configuration
AWS_ACCESS_KEY_ID=sua_access_key_aqui
AWS_SECRET_ACCESS_KEY=sua_secret_key_aqui
AWS_BUCKET_NAME=gerenciei-documentos
AWS_REGION=us-east-1
```

## 🔧 Como Obter as Credenciais AWS

### 1. Criar IAM User no AWS

1. Acesse o [AWS Console](https://console.aws.amazon.com/)
2. Vá em **IAM** > **Users**
3. Clique em **Create user**
4. Escolha um nome (ex: `gerenciei-s3-upload`)
5. Selecione **Programmatic access**

### 2. Configurar Permissões

1. Anexe a política **AmazonS3FullAccess** (para desenvolvimento)
   - Ou crie uma política customizada com permissões mínimas:
   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Effect": "Allow",
         "Action": [
           "s3:PutObject",
           "s3:GetObject",
           "s3:DeleteObject",
           "s3:PutObjectAcl"
         ],
         "Resource": "arn:aws:s3:::gerenciei-documentos/*"
       }
     ]
   }
   ```

### 3. Obter Access Keys

1. Após criar o usuário, anote as credenciais:
   - **Access Key ID**
   - **Secret Access Key**
2. **⚠️ IMPORTANTE**: A Secret Access Key só é mostrada uma vez!

### 4. Configurar o Bucket S3

1. Certifique-se de que o bucket `gerenciei-documentos` existe
2. Configure as permissões do bucket:
   
   **⚠️ IMPORTANTE**: Buckets novos não permitem ACLs de objeto. Siga estes passos:

   a. **Desativar Block Public Access** (se quiser acesso público):
      - No console S3, vá em **Permissions** > **Block public access**
      - Clique em **Edit**
      - **Desmarque** todas as opções OU apenas "Block public access to buckets and objects granted through new access control lists (ACLs)"
      - Salve as mudanças
   
   b. **Adicionar Bucket Policy** para tornar os objetos públicos:
      - Vá em **Permissions** > **Bucket policy**
      - Cole a política abaixo (substitua `gerenciei-documentos` pelo nome do seu bucket)

#### Bucket Policy OBRIGATÓRIA (para acesso público):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "PublicReadGetObject",
      "Effect": "Allow",
      "Principal": "*",
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::gerenciei-documentos/*"
    }
  ]
}
```

**Nota**: Se você não quiser acesso público, pode pular a Bucket Policy e usar presigned URLs (mais seguro, mas requer código adicional).

## 📁 Estrutura de Arquivos no S3

Os arquivos serão salvos com a seguinte estrutura:
```
gerenciei-documentos/
  └── documents/
      ├── 1234567890-987654321.pdf
      ├── 1234567891-123456789.png
      └── ...
```

## 🔗 URLs Geradas

Os arquivos terão URLs públicas no formato:
```
https://gerenciei-documentos.s3.us-east-1.amazonaws.com/documents/1234567890-987654321.pdf
```

## ✅ Verificação

Após configurar:

1. Faça um upload de documento via API
2. Verifique no console S3 se o arquivo apareceu
3. Teste se a URL pública está acessível
4. Teste o download via API

## 🔒 Segurança em Produção

### Para Produção, considere:

1. **Permissões Mínimas**: Use políticas IAM específicas ao invés de FullAccess
2. **Presigned URLs**: Para arquivos privados, gere URLs assinadas temporárias
3. **CORS**: Configure CORS no bucket se necessário
4. **Encriptação**: Ative encriptação no bucket
5. **Lifecycle Policies**: Configure para mover arquivos antigos para Glacier

## 🚨 Troubleshooting

### Erro: "Access Denied"
- Verifique se as credenciais AWS estão corretas
- Verifique se o IAM user tem permissões no bucket
- Verifique a região (AWS_REGION)

### Erro: "Bucket não encontrado"
- Verifique se o nome do bucket está correto
- Verifique se o bucket está na região correta

### Arquivos não aparecem no bucket
- Verifique os logs do servidor
- Verifique se o multer-s3 está funcionando
- Verifique permissões de escrita

### URLs não funcionam
- Verifique se o bucket permite acesso público
- Verifique a Bucket Policy
- Verifique se o ACL está configurado como 'public-read'

