# Configuração do Google Calendar

## 📋 Instruções de Configuração

### 1. Configurar Credenciais do Google

#### Opção A: Service Account (Recomendado para acesso direto)

1. Acesse o [Google Cloud Console](https://console.cloud.google.com/)
2. Crie ou selecione um projeto
3. Ative a **Google Calendar API**:
   - Vá em "APIs & Services" > "Library"
   - Procure por "Google Calendar API"
   - Clique em "Enable"
4. Crie uma Service Account:
   - Vá em "APIs & Services" > "Credentials"
   - Clique em "Create Credentials" > "Service Account"
   - Preencha os dados e crie
   - Clique na Service Account criada
   - Vá na aba "Keys"
   - Clique em "Add Key" > "Create new key"
   - Selecione JSON e baixe o arquivo
5. Compartilhe o calendário com a Service Account:
   - No Google Calendar, vá em "Settings" > "Settings for my calendars"
   - Selecione o calendário desejado
   - Na seção "Share with specific people", adicione o email da Service Account (encontrado no JSON como `client_email`)
   - Dê permissão de "See all event details"

#### Opção B: OAuth Client (Se já tiver credenciais OAuth)

1. Use o arquivo JSON de credenciais OAuth que você já tem
2. Se necessário, configure o `GOOGLE_REFRESH_TOKEN` no `.env`

### 2. Configurar Arquivo de Credenciais

1. Crie a pasta `credentials/` na raiz do projeto (se não existir)
2. Coloque o arquivo JSON de credenciais na pasta `credentials/`
3. Renomeie para `google-credentials.json`

**Estrutura:**
```
backend-nova-gerenciei/
├── credentials/
│   └── google-credentials.json
├── .env
└── ...
```

### 3. Configurar Variáveis de Ambiente

Adicione no arquivo `.env`:

```env
# Google Calendar
GOOGLE_CREDENTIALS_PATH=./credentials/google-credentials.json
GOOGLE_CALENDAR_ID=primary  # ou ID específico do calendário

# Se usar OAuth Client com refresh token (opcional)
GOOGLE_REFRESH_TOKEN=seu_refresh_token_aqui
```

### 4. Adicionar ao .gitignore

Certifique-se de que o `.gitignore` contém:

```
credentials/
*.json
!package*.json
```

---

## 🚀 Uso da API

### Endpoint: `GET /api/calendar/events`

**Autenticação:** 
- Header: `Authorization: Bearer <jwt_token>`

**Query Parameters:**
- `startDate` (opcional) - Data inicial no formato ISO (ex: `2024-01-01T00:00:00Z`)
- `endDate` (opcional) - Data final no formato ISO
- `maxResults` (opcional) - Número máximo de eventos (padrão: 50, máximo: 2500)
- `calendarId` (opcional) - ID do calendário (padrão: 'primary')

**Exemplo de Request:**
```bash
curl -X GET "http://localhost:3000/api/calendar/events?startDate=2024-01-01T00:00:00Z&endDate=2024-01-31T23:59:59Z" \
  -H "Authorization: Bearer seu_jwt_token"
```

**Exemplo de Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "abc123",
      "summary": "Reunião com Cliente",
      "description": "Discussão de projeto",
      "start": "2024-01-15T10:00:00.000Z",
      "end": "2024-01-15T11:00:00.000Z",
      "location": "Sala de Reuniões",
      "attendees": [
        {
          "email": "cliente@example.com",
          "displayName": "João Silva"
        }
      ],
      "status": "confirmed",
      "htmlLink": "https://calendar.google.com/event?eid=...",
      "creator": {
        "email": "criador@example.com",
        "displayName": "Nome do Criador"
      }
    }
  ]
}
```

---

## ⚠️ Troubleshooting

### Erro: "Arquivo de credenciais não encontrado"
- Verifique se o arquivo está em `credentials/google-credentials.json`
- Verifique o caminho configurado em `GOOGLE_CREDENTIALS_PATH`

### Erro: "Sem permissões para acessar o calendário"
- Para Service Account: Certifique-se de compartilhar o calendário com o email da Service Account
- Para OAuth: Verifique se os scopes estão corretos

### Erro: "Credenciais inválidas ou expiradas"
- Verifique se o arquivo JSON está correto
- Para OAuth: Verifique se o refresh token está válido

### Erro: "Calendário não encontrado"
- Verifique o `GOOGLE_CALENDAR_ID` no `.env`
- Use `primary` para o calendário principal
- Para outros calendários, use o ID completo do calendário

---

## 📝 Notas

- A API retorna eventos ordenados por data de início
- Eventos de dia inteiro são retornados com `start` e `end` como datas (sem hora)
- O limite máximo de eventos por requisição é 2500
- A rota requer autenticação JWT do sistema




