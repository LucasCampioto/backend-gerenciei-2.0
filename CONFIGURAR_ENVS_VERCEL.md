# Como Configurar Variáveis de Ambiente na Vercel

O erro `secretOrPrivateKey must have a value` indica que `JWT_SECRET` não está configurado na Vercel.

## Opção 1: Via Dashboard da Vercel (Recomendado)

1. Acesse [Vercel Dashboard](https://vercel.com/dashboard)
2. Selecione seu projeto
3. Vá em **Settings** → **Environment Variables**
4. Adicione as seguintes variáveis:

### Variáveis Obrigatórias:

```
MONGODB_URI=mongodb+srv://usuario:senha@cluster.mongodb.net/database?retryWrites=true&w=majority
JWT_SECRET=seu-secret-jwt-aqui-use-uma-string-longa-e-aleatoria
JWT_EXPIRES_IN=7d
```

### Variáveis Opcionais (se usar):

```
NODE_ENV=production
FRONTEND_URL=https://seu-frontend.com
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
AWS_BUCKET_NAME=...
AWS_REGION=...
```

5. **IMPORTANTE**: Selecione os ambientes onde cada variável deve estar disponível:
   - ✅ Production
   - ✅ Preview
   - ✅ Development (se quiser testar localmente com `vercel dev`)

6. Clique em **Save**

## Opção 2: Via CLI da Vercel

```bash
# Adicionar JWT_SECRET
vercel env add JWT_SECRET production

# Adicionar MONGODB_URI
vercel env add MONGODB_URI production

# Adicionar JWT_EXPIRES_IN
vercel env add JWT_EXPIRES_IN production
```

Quando executar cada comando, você será solicitado a inserir o valor.

## Opção 3: Puxar envs existentes

Se você já configurou as envs no dashboard, puxe para testar localmente:

```bash
vercel pull --environment=production
```

Isso cria o arquivo `.vercel/.env.production.local` com as variáveis.

## Verificar se as envs estão configuradas

```bash
# Listar todas as envs
vercel env ls
```

## Gerar um JWT_SECRET seguro

Você pode gerar um secret seguro usando:

```bash
# Node.js
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"

# Ou online
# https://randomkeygen.com/
```

Use uma string longa e aleatória (mínimo 32 caracteres, recomendado 64+).

## Após configurar

1. Faça um novo deploy ou aguarde o próximo
2. As variáveis estarão disponíveis automaticamente
3. Teste novamente a rota de login

## Verificar nos logs

Após configurar, você verá nos logs do `vercel dev` ou na Vercel:

```
MONGODB_URI exists? true
JWT_SECRET exists? true
```

Se aparecer `false`, a variável não está configurada corretamente.

