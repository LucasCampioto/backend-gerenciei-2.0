# Testes de Diagnóstico - MongoDB Atlas na Vercel

Este guia ajuda a diagnosticar problemas de conexão com MongoDB Atlas na Vercel.

## 1. Verificar variáveis de ambiente na Vercel

### Via CLI:
```bash
vercel env ls
```

Isso lista todas as variáveis de ambiente configuradas no projeto Vercel.

### Verificar se a env está chegando no handler:

Quando rodar `vercel dev`, você verá nos logs:
- `MONGODB_URI exists? true` ou `false`
- `MONGODB_URI starts with mongodb? true` ou `false`

**Se aparecer `false` no `vercel dev`:**
- Você está testando sem as envs corretas
- Ou puxou o environment errado
- Execute: `vercel pull --environment=production`

## 2. Teste isolado de conexão MongoDB

Este teste verifica se o problema é de rede/conexão ou da aplicação.

### Passo 1: Puxar as envs da Vercel
```bash
vercel pull --environment=production
```

Isso cria o arquivo `.vercel/.env.production.local` com as variáveis de ambiente.

### Passo 2: Executar o script de teste
```bash
node -r dotenv/config scripts/mongo-test.js dotenv_config_path=.vercel/.env.production.local
```

### Interpretação dos resultados:

**Se o script falhar:**
- O problema é **Atlas/Network/DNS/Auth** (não é Express/rotas)
- Verifique:
  - IP whitelist no MongoDB Atlas (adicione `0.0.0.0/0` temporariamente)
  - String de conexão está correta
  - Usuário e senha estão corretos
  - Cluster está acessível

**Se o script funcionar:**
- A conexão MongoDB está OK
- O problema está na aplicação/Express
- Verifique os logs do `vercel dev` para erros específicos

## 3. Erros comuns e soluções

### `MongoServerSelectionError`
- Problema de rede ou DNS
- Verifique IP whitelist no Atlas

### `Authentication failed`
- Credenciais incorretas
- Verifique usuário e senha na string de conexão

### `ENOTFOUND`
- Problema de DNS
- Verifique se a string de conexão está correta

### `buffering timed out`
- Geralmente significa que a `MONGODB_URI` não está chegando
- Verifique os logs do `vercel dev` para confirmar

## 4. Comandos úteis

```bash
# Instalar Vercel CLI globalmente
npm i -g vercel

# Fazer login na Vercel
vercel login

# Linkar projeto local com projeto Vercel
vercel link

# Puxar envs de produção
vercel pull --environment=production

# Rodar localmente como na Vercel
vercel dev

# Listar envs configuradas
vercel env ls
```

## 5. Testar rotas localmente

Após rodar `vercel dev`, teste as rotas:

```bash
curl http://localhost:3000/health
curl http://localhost:3000/api/auth/login
```


