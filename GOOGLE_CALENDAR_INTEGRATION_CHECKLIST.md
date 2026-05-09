# Checklist de Integração com Google Calendar

## 📋 Visão Geral
Implementar uma rota externa que retorna agendamentos do Google Calendar usando credenciais JSON já configuradas (Service Account ou OAuth já autenticado).

**Abordagem Simplificada:**
- Usar credenciais JSON diretamente (sem fluxo OAuth interativo)
- Rota principal: `GET /api/calendar/events` que retorna agendamentos
- Autenticação JWT do sistema existente para proteger a rota

---

## 🔧 Fase 1: Configuração Inicial

### 1.1 Instalar Dependências
- [ ] Instalar `googleapis` - Biblioteca oficial do Google para Node.js
- [ ] Verificar compatibilidade com versão do Node.js atual
- [ ] Atualizar `package.json` com as novas dependências

**Comando:**
```bash
npm install googleapis
```

### 1.2 Estrutura de Arquivos de Credenciais
- [ ] Criar pasta `credentials/` na raiz do projeto
- [ ] Mover arquivo JSON de credenciais para `credentials/google-credentials.json`
- [ ] Adicionar `credentials/` ao `.gitignore` (se já não estiver)
- [ ] Configurar variável de ambiente `GOOGLE_CREDENTIALS_PATH` no `.env`

**Estrutura:**
```
backend-nova-gerenciei/
├── credentials/
│   └── google-credentials.json (não versionar)
├── .env
└── ...
```

**Variáveis de ambiente (.env):**
```env
GOOGLE_CREDENTIALS_PATH=./credentials/google-credentials.json
GOOGLE_CALENDAR_ID=primary  # ou ID específico do calendário
```

---

## 🗄️ Fase 2: Serviço do Google Calendar

### 2.1 Criar Serviço de Calendar
- [ ] Criar `src/services/googleCalendar.service.js`
- [ ] Implementar função para inicializar cliente Google Calendar usando credenciais JSON
- [ ] Implementar função `getEvents(options)` - lista eventos/agendamentos
  - Parâmetros: `timeMin`, `timeMax`, `maxResults`, `calendarId`
- [ ] Formatar resposta para padrão do projeto
- [ ] Tratar erros da API do Google

**Tipo de Credenciais:**
- **Service Account**: Acesso direto sem OAuth
- **OAuth Client**: Se já tiver tokens salvos, usar diretamente

**Formato de resposta esperado:**
```json
{
  "success": true,
  "data": [
    {
      "id": "string",
      "summary": "string",
      "description": "string",
      "start": "2024-01-01T10:00:00.000Z",
      "end": "2024-01-01T11:00:00.000Z",
      "location": "string",
      "attendees": [
        {
          "email": "string",
          "displayName": "string"
        }
      ],
      "status": "confirmed",
      "htmlLink": "string"
    }
  ]
}
```

---

## 🎮 Fase 3: Controller

### 3.1 Criar Controller de Calendário
- [ ] Criar `src/controllers/calendar.controller.js`
- [ ] Implementar função `getEvents` - lista agendamentos
  - Query params: `startDate`, `endDate`, `maxResults`, `calendarId`
  - Validar datas e parâmetros
- [ ] Formatar respostas no padrão do projeto
- [ ] Tratar erros apropriadamente
- [ ] Usar autenticação JWT existente (middleware `authenticate`)

**Query Parameters:**
- `startDate` (ISO date) - Data inicial para filtrar eventos
- `endDate` (ISO date) - Data final para filtrar eventos
- `maxResults` (number) - Número máximo de eventos (padrão: 50)
- `calendarId` (string) - ID do calendário (padrão: 'primary')

---

## 🛣️ Fase 4: Rotas

### 4.1 Criar Rotas de Calendário
- [ ] Criar `src/routes/calendar.routes.js`
- [ ] Definir rota principal:
  - `GET /api/calendar/events` - lista agendamentos
- [ ] Aplicar middleware de autenticação JWT (`authenticate`)
- [ ] Adicionar validações de query params (datas, formato, etc.)

### 4.2 Integrar no App
- [ ] Importar rotas no `src/app.js`
- [ ] Adicionar rota `/api/calendar` no app
- [ ] Testar se a rota está acessível

---

## ✅ Fase 5: Validações e Tratamento de Erros

### 5.1 Validações
- [ ] Validar query params nas rotas (datas, formato, etc.)
- [ ] Validar formato de resposta da API do Google
- [ ] Criar validators Joi para query params (opcional)

### 5.2 Tratamento de Erros
- [ ] Tratar erro de credenciais inválidas
- [ ] Tratar erro de permissões insuficientes
- [ ] Tratar erro de calendário não encontrado
- [ ] Tratar erro de conexão com API do Google
- [ ] Retornar erros no formato padrão do projeto

**Códigos de erro comuns:**
- `400` - Parâmetros inválidos
- `401` - Não autenticado (JWT)
- `403` - Sem permissões no Google Calendar
- `404` - Calendário não encontrado
- `500` - Erro interno

---

## 🔍 Fase 6: Implementação Detalhada

### 6.1 Serviço Google Calendar

**Estrutura básica:**
```javascript
// src/services/googleCalendar.service.js
const { google } = require('googleapis');
const path = require('path');
const fs = require('fs');

async function initializeCalendarClient() {
  // Carregar credenciais JSON
  // Inicializar cliente (Service Account ou OAuth)
  // Retornar cliente configurado
}

async function getEvents(options = {}) {
  // Usar cliente para buscar eventos
  // Formatar resposta
  // Retornar eventos
}
```

### 6.2 Controller

**Estrutura básica:**
```javascript
// src/controllers/calendar.controller.js
async function getEvents(req, res, next) {
  try {
    const { startDate, endDate, maxResults, calendarId } = req.query;
    
    // Validar parâmetros
    // Chamar serviço do Google Calendar
    // Formatar resposta
    // Retornar eventos
  } catch (error) {
    next(error);
  }
}
```

---

## 📝 Endpoints Finais

### 1. GET `/api/calendar/events`
**Descrição:** Retorna lista de agendamentos do Google Calendar

**Autenticação:** JWT Token no header `Authorization: Bearer <token>`

**Query Parameters:**
- `startDate` (opcional) - Data inicial no formato ISO (ex: `2024-01-01T00:00:00Z`)
- `endDate` (opcional) - Data final no formato ISO
- `maxResults` (opcional) - Número máximo de eventos (padrão: 50)
- `calendarId` (opcional) - ID do calendário (padrão: 'primary')

**Exemplo de Request:**
```
GET /api/calendar/events?startDate=2024-01-01T00:00:00Z&endDate=2024-01-31T23:59:59Z
Headers:
  Authorization: Bearer <jwt_token>
```

**Exemplo de Response (200):**
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
      "htmlLink": "https://calendar.google.com/event?eid=..."
    }
  ]
}
```

**Erros:**
- `400` - Parâmetros inválidos
- `401` - Token JWT inválido ou ausente
- `403` - Sem permissões no Google Calendar
- `500` - Erro ao buscar eventos

---

## 🧪 Fase 7: Testes

### 7.1 Testes Básicos
- [ ] Testar rota com autenticação JWT válida
- [ ] Testar rota sem autenticação (deve retornar 401)
- [ ] Testar com diferentes parâmetros de data
- [ ] Testar com calendário específico
- [ ] Testar tratamento de erros

### 7.2 Validações
- [ ] Validar formato de datas
- [ ] Validar limites de maxResults
- [ ] Validar formato de resposta

---

## ⚠️ Pontos de Atenção

### Segurança
- [ ] Nunca commitar arquivo de credenciais
- [ ] Proteger rota com autenticação JWT
- [ ] Validar todas as entradas do usuário
- [ ] Usar HTTPS em produção

### Performance
- [ ] Limitar número máximo de resultados (evitar sobrecarga)
- [ ] Considerar cache se necessário
- [ ] Otimizar queries de eventos

### Experiência
- [ ] Mensagens de erro claras
- [ ] Documentar API
- [ ] Fornecer exemplos de uso

---

## 📦 Estrutura de Arquivos Final

```
src/
├── controllers/
│   └── calendar.controller.js
├── routes/
│   └── calendar.routes.js
├── services/
│   └── googleCalendar.service.js
└── validators/
    └── calendar.validator.js (opcional)
```

---

## ✅ Critérios de Aceitação

- [ ] Rota `/api/calendar/events` retorna agendamentos
- [ ] Rota protegida com autenticação JWT
- [ ] Suporta filtros por data (startDate, endDate)
- [ ] Resposta no formato padrão do projeto
- [ ] Tratamento de erros funcionando
- [ ] Credenciais JSON funcionando corretamente
- [ ] Integração funcional em produção

---

## 🔧 Configuração de Credenciais

### Service Account (Recomendado para acesso direto)
1. Ir ao Google Cloud Console
2. Criar/Selecionar projeto
3. Ativar Google Calendar API
4. Criar Service Account
5. Baixar JSON de credenciais
6. Compartilhar calendário com email do Service Account

### OAuth Client (Se já tiver tokens)
1. Usar credenciais JSON existentes
2. Se tiver tokens salvos, usar diretamente
3. Se não tiver, implementar fluxo OAuth uma vez

---

**Data de Criação:** {{ data_atual }}
**Última Atualização:** {{ data_atual }}
**Abordagem:** Simplificada - Rota direta com credenciais JSON
