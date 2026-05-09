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

## Outras Variáveis Necessárias

```env
# Database
MONGODB_URI=mongodb://localhost:27017/signly

# JWT
JWT_SECRET=seu-jwt-secret-aqui
JWT_EXPIRES_IN=7d

# Server
PORT=3000
```

