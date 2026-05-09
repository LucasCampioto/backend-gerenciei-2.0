# Como Configurar FRONTEND_URL

## O que é FRONTEND_URL?

É simplesmente a **URL do seu front-end** (a aplicação web que o usuário acessa).

## Para que serve?

Após o usuário autorizar o Google Calendar, o backend precisa redirecionar o usuário de volta para o front-end. O `FRONTEND_URL` é usado para isso.

## Como configurar?

### Passo 1: Descobrir a URL do seu front-end

A URL do seu front-end pode ser:
- **Desenvolvimento local**: `http://localhost:8080` (ou a porta que você usa)
- **Produção**: `https://seu-frontend.vercel.app` ou `https://seu-dominio.com`

### Passo 2: Adicionar na Vercel

#### Opção A: Via Dashboard (Mais fácil)

1. Acesse [Vercel Dashboard](https://vercel.com/dashboard)
2. Selecione seu projeto **backend**
3. Vá em **Settings** → **Environment Variables**
4. Clique em **Add New**
5. Preencha:
   - **Key**: `FRONTEND_URL`
   - **Value**: A URL do seu front-end (ex: `https://seu-frontend.vercel.app`)
   - **Environments**: Marque ✅ Production, ✅ Preview, ✅ Development
6. Clique em **Save**

#### Opção B: Via CLI

```bash
vercel env add FRONTEND_URL production
# Quando solicitado, digite a URL do seu front-end
# Exemplo: https://seu-frontend.vercel.app
```

### Passo 3: Verificar

Após adicionar, faça um novo deploy ou aguarde o próximo. A variável estará disponível automaticamente.

## Exemplos de valores:

```bash
# Desenvolvimento local
FRONTEND_URL=http://localhost:8080

# Produção (Vercel)
FRONTEND_URL=https://meu-frontend.vercel.app

# Produção (domínio próprio)
FRONTEND_URL=https://app.seudominio.com
```

## Preciso mudar algo no front-end?

**NÃO!** Você não precisa mudar nada no front-end.

O front-end só precisa ter uma rota/página que receba os parâmetros de sucesso/erro:

- **Sucesso**: `/calendar/connected?success=true`
- **Erro**: `/calendar/connected?success=false&error=...`

Essa página já deve existir no seu front-end (ou você precisa criá-la para mostrar o resultado da conexão).

## Resumo:

1. ✅ Descubra a URL do seu front-end
2. ✅ Adicione `FRONTEND_URL` na Vercel com essa URL
3. ✅ Pronto! Não precisa mudar nada no código do front-end

