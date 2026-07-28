# Variáveis de Ambiente Necessárias

## Configuração OAuth2 Google Calendar

Adicione estas variáveis no seu arquivo `.env`:

```env
# Google Calendar OAuth2
GOOGLE_CLIENT_ID=seu-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=seu-client-secret
GOOGLE_REDIRECT_URI=http://localhost:3000/api/calendar/oauth/callback

# Front-end URL (para redirecionar após callback OAuth)
FRONTEND_URL=http://localhost:8080
```

## Como Obter as Credenciais

1. Acesse [Google Cloud Console](https://console.cloud.google.com/)
2. Crie um projeto ou selecione um existente
3. Ative a **Google Calendar API**:
   - Vá em "APIs & Services" > "Library"
   - Procure por "Google Calendar API"
   - Clique em "Enable"
4. Crie um OAuth 2.0 Client ID:
   - Vá em "APIs & Services" > "Credentials"
   - Clique em "Create Credentials" > "OAuth client ID"
   - Tipo: "Web application"
   - Configure **Authorized redirect URIs**:
     - Desenvolvimento: `http://localhost:3000/api/calendar/oauth/callback`
     - Produção: `https://seu-dominio.com/api/calendar/oauth/callback`
5. Copie o **Client ID** e **Client Secret** para o `.env`

## Core

```env
# Database
MONGODB_URI=mongodb://localhost:27017/signly

# JWT
JWT_SECRET=seu-jwt-secret-aqui
JWT_EXPIRES_IN=7d

# Server
PORT=3000

# CORS / front
CORS_ORIGIN=http://localhost:8080
FRONTEND_URL=http://localhost:8080
FRONTEND_LOGIN_URL=http://localhost:8080/login
```

## Inteligência comercial (Agno)

```env
# URL do serviço agents-gerenciei. Se vazio, usa heurísticas locais (fallback).
AGNO_BASE_URL=http://localhost:7777
# Chave compartilhada Node <-> Agno (mesmo valor nos dois .env)
AGNO_SERVICE_KEY=troque-por-uma-chave-secreta
# AGNO_ENABLED=false  # força desligar chamadas ao Agno
```

## Stripe (assinaturas)

```env
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
# Price IDs permitidos no checkout (vírgula)
STRIPE_PRICE_IDS=price_xxx,price_yyy

# Checkout hosted
STRIPE_SUCCESS_URL=http://localhost:8080/assinatura/sucesso?session_id={CHECKOUT_SESSION_ID}
STRIPE_CANCEL_URL=http://localhost:8080/assinatura/cancelado

# Checkout embedded — URL da app de gestão (inclua {CHECKOUT_SESSION_ID})
STRIPE_RETURN_URL=http://localhost:8080/configuracoes/assinatura?session_id={CHECKOUT_SESSION_ID}

# Billing Portal
STRIPE_BILLING_PORTAL_RETURN_URL=http://localhost:8080/configuracoes/assinatura

# Trial padrão (dias) se o body do checkout não enviar trialPeriodDays
TRIAL_PERIOD_DAYS=7

# Link de login nos e-mails de boas-vindas pós-assinatura / parceiro
SUBSCRIPTION_WELCOME_LOGIN_URL=http://localhost:8080/login

# IDs Mongo (User._id) isentos de bloqueio por assinatura inativa (vírgula)
SUBSCRIPTION_BYPASS_USER_IDS=
# Cota do plano Starter (LUNI) para contas admin sem Stripe
SUBSCRIPTION_BYPASS_MONTHLY_QUOTA=40
SUBSCRIPTION_BYPASS_PREVIEW_MONTHLY_QUOTA=20
```

Rotas: `POST /api/stripe/webhook` (raw body), `GET|POST /api/subscriptions/*`.

## Cotas de simulação / preview

Planos LUNI (landing):
- **Starter:** 40 simulações + 20 pré-visualizações/mês
- **Pro:** 100 simulações + 50 pré-visualizações/mês

```env
# JSON por Stripe Price ID
SIMULATION_QUOTA_BY_PRICE_ID={"price_xxx":40,"price_yyy":100}
PREVIEW_QUOTA_BY_PRICE_ID={"price_xxx":20,"price_yyy":50}

# Timezone da virada mensal civil (padrão America/Sao_Paulo)
SIMULATION_QUOTA_TIMEZONE=America/Sao_Paulo
```

Renovação mensal: contas `official` com `subscriptionStatus === active` e `stripeSubscriptionId`; ou IDs em `SUBSCRIPTION_BYPASS_USER_IDS`. Disparada no login/`GET /api/auth/me` e ao debitar créditos.

## Cloudflare R2 (pares enhance)

```env
R2_ENDPOINT=https://<account_id>.r2.cloudflarestorage.com
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET_NAME=gerenciei-enhance
# Opcional: URL pública (senão usa signed URLs)
R2_PUBLIC_BASE_URL=
R2_SIGNED_URL_TTL_SECONDS=900
```

## Agente de enhance (IA)

```env
ENHANCE_AGENT_BASE_URL=http://localhost:8000
```

Rotas: `POST /v1/enhance?format=json`, `POST /v1/enhance/finalize`, `GET /api/enhance-pairs/:pairId`.

## Admin (parceiros + usage IA)

```env
ADMIN_API_KEY=string-longa-e-secreta
```

Header: `x-admin-key: <ADMIN_API_KEY>`. Rotas em `/api/admin/*` (partner-users, usage/*).

## E-mail (Resend)

```env
RESEND_API_KEY=re_...
EMAIL_FROM=Gerenciei <noreply@seudominio.com>
```

Usado em boas-vindas de assinatura, conta parceiro e (quando implementado) reset de senha.

## Legal / termos

Versão vigente em código: `src/legal/version.js` (`LEGAL_VERSION`, ex. `2026-05-v1`).

Checkout e `POST /api/auth/accept-terms` exigem `termsVersion` igual a `LEGAL_VERSION`. Middleware `createTermsAcceptanceGuard` bloqueia rotas autenticadas até aceite de termos + privacidade + responsabilidade sobre dados de clientes/pacientes.

## Custo de uso de IA (analytics admin)

```env
GEMINI_INPUT_USD_PER_1M=0.10
GEMINI_IMAGE_OUTPUT_USD_PER_1M=30
USD_TO_BRL=5.5
```

## Proxy / Vercel

```env
# TRUST_PROXY=1
```

## Cutover LUNI → Gerenciei (checklist)

Operação após deploy deste módulo (repos `luni-backend` / `luni-portal` deixam de ser usados):

1. Configurar no `.env` da Gerenciei: Stripe, mapas de cota, `ENHANCE_AGENT_BASE_URL` (luni-agent), R2, Resend, `ADMIN_API_KEY`, `SUBSCRIPTION_BYPASS_USER_IDS` (donos / contas legadas).
2. Apontar webhook Stripe para `POST /api/stripe/webhook` da Gerenciei (não mais LUNI).
3. Contas existentes da Gerenciei sem Stripe ficam bloqueadas (gate total) até bypass, partner_test ou checkout.
4. Signup público permanece **403** — entrada via Stripe checkout ou `POST /api/admin/partner-users`.
5. Validar manualmente: partner lock, past_due, trial, bypass, preview/final/finalize, R2 off, consentimento foto, termos.
6. `npm test` no backend (regras de cota/lock).
7. Landing LUNI fica para um plano posterior; agent permanece separado.
