# Checklist de Implementação Front-end - Google Calendar OAuth2

## 📋 Visão Geral

Este documento descreve todas as implementações necessárias no front-end para integrar com o Google Calendar usando OAuth2. O fluxo é separado do login (Opção A): usuário faz login normal e depois conecta o Calendar quando necessário.

---

## 🔐 Configuração Inicial

### Variáveis de Ambiente

Adicione no seu `.env` do front-end:

```env
VITE_API_URL=http://localhost:3000/api
# ou
REACT_APP_API_URL=http://localhost:3000/api
```

---

## 🛣️ Rotas da API

### Base URL
```
http://localhost:3000/api/calendar
```

### Autenticação
Todas as rotas (exceto callback) requerem header:
```
Authorization: Bearer <JWT_TOKEN>
```

---

## 📡 Endpoints Disponíveis

### 1. Iniciar Fluxo OAuth
**GET** `/api/calendar/oauth/initiate`

**Headers:**
```
Authorization: Bearer <JWT_TOKEN>
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "authUrl": "https://accounts.google.com/o/oauth2/auth?..."
  },
  "message": "URL de autorização gerada com sucesso"
}
```

**Uso:** Obter URL para redirecionar usuário para Google

---

### 2. Callback OAuth (Google redireciona aqui)
**GET** `/api/calendar/oauth/callback`

**Query Parameters:**
- `code`: Código de autorização (fornecido pelo Google)
- `state`: State para validação (fornecido pelo Google)
- `error`: Erro se usuário negou permissões

**Response:** Redireciona para front-end:
```
http://localhost:8080/calendar/connected?success=true
ou
http://localhost:8080/calendar/connected?success=false&error=...
```

**Uso:** Esta rota é chamada automaticamente pelo Google. Não precisa chamar manualmente.

---

### 3. Verificar Status de Conexão
**GET** `/api/calendar/oauth/status`

**Headers:**
```
Authorization: Bearer <JWT_TOKEN>
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "connected": true,
    "email": "usuario@gmail.com",
    "connectedAt": "2024-01-15T10:30:00.000Z"
  }
}
```

**Response quando não conectado:**
```json
{
  "success": true,
  "data": {
    "connected": false,
    "email": null,
    "connectedAt": null
  }
}
```

**Uso:** Verificar se usuário já conectou o Calendar

---

### 4. Desconectar Google Calendar
**POST** `/api/calendar/oauth/disconnect`

**Headers:**
```
Authorization: Bearer <JWT_TOKEN>
```

**Response (200):**
```json
{
  "success": true,
  "message": "Google Calendar desconectado com sucesso"
}
```

**Uso:** Remover conexão do Calendar

---

### 5. Buscar Eventos do Calendar
**GET** `/api/calendar/events`

**Headers:**
```
Authorization: Bearer <JWT_TOKEN>
```

**Query Parameters:**
- `startDate` (opcional): Data inicial no formato ISO (ex: `2024-01-01T00:00:00Z`)
- `endDate` (opcional): Data final no formato ISO (ex: `2024-01-31T23:59:59Z`)
- `maxResults` (opcional): Número máximo de eventos (padrão: 50, máximo: 2500)
- `calendarId` (opcional): ID do calendário (padrão: `primary`)
- `maxEventsPerDay` (opcional): Limitar eventos por dia

**Response (200):**
```json
{
  "success": true,
  "data": [
    {
      "id": "event_id_123",
      "summary": "Reunião com Cliente",
      "description": "Discussão sobre projeto",
      "start": "2024-01-15T10:00:00Z",
      "end": "2024-01-15T11:00:00Z",
      "location": "Sala de Reuniões",
      "attendees": [
        {
          "email": "cliente@email.com",
          "displayName": "Cliente"
        }
      ],
      "status": "confirmed",
      "htmlLink": "https://calendar.google.com/...",
      "creator": {
        "email": "usuario@gmail.com",
        "displayName": "Usuário"
      }
    }
  ],
  "groupedByDate": {
    "2024-01-15": [...],
    "2024-01-16": [...]
  },
  "totalEvents": 10,
  "totalDays": 3
}
```

**Erros:**

**403 - Calendar não conectado:**
```json
{
  "success": false,
  "error": "Usuário não conectou o Google Calendar. Conecte sua conta primeiro.",
  "code": "CALENDAR_NOT_CONNECTED"
}
```

**401 - Token expirado:**
```json
{
  "success": false,
  "error": "Credenciais inválidas ou expiradas. Reconecte sua conta do Google Calendar.",
  "code": "CALENDAR_AUTH_ERROR"
}
```

**403 - Sem permissões:**
```json
{
  "success": false,
  "error": "Sem permissões para acessar o calendário.",
  "code": "CALENDAR_PERMISSION_ERROR"
}
```

**404 - Calendário não encontrado:**
```json
{
  "success": false,
  "error": "Calendário não encontrado. Verifique se o ID está correto: primary",
  "code": "CALENDAR_NOT_FOUND"
}
```

---

## 🎨 Implementação Front-end

### 1. Componente de Status de Conexão

Crie um componente para mostrar status e botão de conectar/desconectar:

```typescript
// CalendarConnectionStatus.tsx (React/TypeScript)
import { useState, useEffect } from 'react';

interface ConnectionStatus {
  connected: boolean;
  email: string | null;
  connectedAt: string | null;
}

function CalendarConnectionStatus() {
  const [status, setStatus] = useState<ConnectionStatus | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    checkStatus();
  }, []);

  const checkStatus = async () => {
    try {
      const token = localStorage.getItem('token'); // ou do seu contexto de auth
      const response = await fetch(`${API_URL}/calendar/oauth/status`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      const data = await response.json();
      setStatus(data.data);
    } catch (error) {
      console.error('Erro ao verificar status:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleConnect = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`${API_URL}/calendar/oauth/initiate`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      const data = await response.json();
      
      // Redirecionar para Google
      window.location.href = data.data.authUrl;
      // OU abrir em popup (melhor UX):
      // window.open(data.data.authUrl, 'google-auth', 'width=500,height=600');
    } catch (error) {
      console.error('Erro ao iniciar OAuth:', error);
      alert('Erro ao conectar Google Calendar');
    }
  };

  const handleDisconnect = async () => {
    if (!confirm('Deseja desconectar o Google Calendar?')) return;

    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`${API_URL}/calendar/oauth/disconnect`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      
      if (response.ok) {
        await checkStatus(); // Atualizar status
        alert('Google Calendar desconectado com sucesso');
      }
    } catch (error) {
      console.error('Erro ao desconectar:', error);
      alert('Erro ao desconectar Google Calendar');
    }
  };

  if (loading) return <div>Carregando...</div>;

  return (
    <div>
      {status?.connected ? (
        <div>
          <p>✅ Conectado: {status.email}</p>
          <button onClick={handleDisconnect}>Desconectar</button>
        </div>
      ) : (
        <div>
          <p>❌ Google Calendar não conectado</p>
          <button onClick={handleConnect}>Conectar Google Calendar</button>
        </div>
      )}
    </div>
  );
}
```

---

### 2. Página de Callback

Crie uma página para receber o callback do Google:

```typescript
// CalendarConnected.tsx
import { useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';

function CalendarConnected() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  useEffect(() => {
    const success = searchParams.get('success') === 'true';
    const error = searchParams.get('error');

    if (success) {
      alert('Google Calendar conectado com sucesso!');
      navigate('/dashboard'); // ou onde quiser redirecionar
    } else {
      alert(`Erro ao conectar: ${error || 'Erro desconhecido'}`);
      navigate('/settings'); // ou página de configurações
    }
  }, [searchParams, navigate]);

  return <div>Processando conexão...</div>;
}
```

**Rota (React Router):**
```typescript
<Route path="/calendar/connected" element={<CalendarConnected />} />
```

---

### 3. Componente para Buscar Eventos

```typescript
// CalendarEvents.tsx
import { useState, useEffect } from 'react';

interface CalendarEvent {
  id: string;
  summary: string;
  description: string;
  start: string;
  end: string;
  location: string;
  attendees: Array<{ email: string; displayName: string }>;
  status: string;
  htmlLink: string;
  creator: { email: string; displayName: string } | null;
}

function CalendarEvents() {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchEvents = async (startDate?: string, endDate?: string) => {
    setLoading(true);
    setError(null);

    try {
      const token = localStorage.getItem('token');
      const params = new URLSearchParams();
      if (startDate) params.append('startDate', startDate);
      if (endDate) params.append('endDate', endDate);
      params.append('maxResults', '50');

      const response = await fetch(
        `${API_URL}/calendar/events?${params.toString()}`,
        {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        }
      );

      const data = await response.json();

      if (!response.ok) {
        // Verificar se é erro de não conectado
        if (data.code === 'CALENDAR_NOT_CONNECTED') {
          setError('Conecte seu Google Calendar primeiro');
          return;
        }
        throw new Error(data.error || 'Erro ao buscar eventos');
      }

      setEvents(data.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro desconhecido');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // Buscar eventos da semana atual
    const today = new Date();
    const nextWeek = new Date(today);
    nextWeek.setDate(today.getDate() + 7);

    fetchEvents(
      today.toISOString(),
      nextWeek.toISOString()
    );
  }, []);

  if (loading) return <div>Carregando eventos...</div>;
  if (error) return <div>Erro: {error}</div>;

  return (
    <div>
      <h2>Eventos do Calendar</h2>
      {events.length === 0 ? (
        <p>Nenhum evento encontrado</p>
      ) : (
        <ul>
          {events.map((event) => (
            <li key={event.id}>
              <strong>{event.summary}</strong>
              <p>{new Date(event.start).toLocaleString()}</p>
              <p>{event.location}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

---

### 4. Hook Customizado (Opcional)

Para facilitar o uso em múltiplos componentes:

```typescript
// useGoogleCalendar.ts
import { useState, useEffect } from 'react';

export function useGoogleCalendar() {
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    checkConnection();
  }, []);

  const checkConnection = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`${API_URL}/calendar/oauth/status`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await response.json();
      setConnected(data.data.connected);
    } catch (error) {
      console.error('Erro ao verificar conexão:', error);
    } finally {
      setLoading(false);
    }
  };

  const connect = async () => {
    const token = localStorage.getItem('token');
    const response = await fetch(`${API_URL}/calendar/oauth/initiate`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await response.json();
    window.location.href = data.data.authUrl;
  };

  const disconnect = async () => {
    const token = localStorage.getItem('token');
    await fetch(`${API_URL}/calendar/oauth/disconnect`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    await checkConnection();
  };

  return { connected, loading, connect, disconnect, refresh: checkConnection };
}
```

**Uso:**
```typescript
const { connected, loading, connect, disconnect } = useGoogleCalendar();
```

---

## 📝 Checklist de Implementação

### Fase 1: Configuração
- [ ] Adicionar variável de ambiente `API_URL`
- [ ] Configurar interceptor de requisições para adicionar JWT token automaticamente
- [ ] Criar tipos/interfaces TypeScript (se usar TS)

### Fase 2: Componentes de Conexão
- [ ] Criar componente `CalendarConnectionStatus`
- [ ] Criar página `CalendarConnected` (callback)
- [ ] Adicionar rota `/calendar/connected` no router
- [ ] Criar hook `useGoogleCalendar` (opcional)

### Fase 3: Componentes de Eventos
- [ ] Criar componente `CalendarEvents`
- [ ] Implementar filtros de data (opcional)
- [ ] Implementar paginação (opcional)
- [ ] Adicionar tratamento de erros específicos

### Fase 4: Integração
- [ ] Adicionar botão "Conectar Calendar" na página de configurações
- [ ] Mostrar status de conexão no dashboard
- [ ] Integrar eventos do Calendar na interface principal
- [ ] Adicionar notificações de sucesso/erro

### Fase 5: Tratamento de Erros
- [ ] Tratar erro `CALENDAR_NOT_CONNECTED` (mostrar botão para conectar)
- [ ] Tratar erro `CALENDAR_AUTH_ERROR` (sugerir reconexão)
- [ ] Tratar erro `CALENDAR_PERMISSION_ERROR` (mostrar mensagem)
- [ ] Tratar erro `CALENDAR_NOT_FOUND` (mostrar mensagem)

### Fase 6: UX/UI
- [ ] Adicionar loading states
- [ ] Adicionar mensagens de feedback
- [ ] Melhorar design dos componentes
- [ ] Adicionar animações (opcional)

---

## 🔄 Fluxo Completo

### 1. Usuário faz login normal
```
POST /api/auth/login
→ Recebe JWT token
→ Salva no localStorage/sessionStorage
```

### 2. Usuário clica "Conectar Google Calendar"
```
GET /api/calendar/oauth/initiate (com JWT)
→ Recebe authUrl
→ Redireciona para authUrl
```

### 3. Google mostra tela de consentimento
```
Usuário autoriza permissões
→ Google redireciona para /api/calendar/oauth/callback
```

### 4. Back-end processa callback
```
Back-end troca code por tokens
→ Salva no banco
→ Redireciona para /calendar/connected?success=true
```

### 5. Front-end mostra sucesso
```
Página CalendarConnected detecta success=true
→ Mostra mensagem de sucesso
→ Redireciona para dashboard
```

### 6. Usuário busca eventos
```
GET /api/calendar/events (com JWT)
→ Back-end usa tokens do usuário
→ Retorna eventos do Calendar
```

---

## 🎯 Exemplos de Uso

### Exemplo 1: Buscar eventos da semana
```typescript
const startDate = new Date();
const endDate = new Date();
endDate.setDate(startDate.getDate() + 7);

fetch(`${API_URL}/calendar/events?startDate=${startDate.toISOString()}&endDate=${endDate.toISOString()}`)
```

### Exemplo 2: Buscar eventos de um mês específico
```typescript
const january = new Date('2024-01-01');
const february = new Date('2024-02-01');

fetch(`${API_URL}/calendar/events?startDate=${january.toISOString()}&endDate=${february.toISOString()}`)
```

### Exemplo 3: Buscar apenas 10 eventos
```typescript
fetch(`${API_URL}/calendar/events?maxResults=10`)
```

---

## ⚠️ Pontos de Atenção

1. **Token JWT**: Sempre incluir no header `Authorization: Bearer <token>`
2. **Callback URL**: Deve corresponder ao configurado no Google Cloud Console
3. **State**: O back-end valida o state para segurança (não precisa fazer nada no front)
4. **Erros**: Sempre verificar o campo `code` para tratamento específico
5. **Refresh Token**: O back-end renova automaticamente, não precisa fazer nada

---

## 🚀 Próximos Passos

Após implementar o básico, considere:

- [ ] Cache de eventos no front-end
- [ ] Sincronização automática (polling)
- [ ] Filtros avançados (por calendário, tipo de evento, etc)
- [ ] Visualização em calendário (biblioteca como FullCalendar)
- [ ] Notificações de novos eventos
- [ ] Sincronização bidirecional (criar eventos no Calendar)

---

## 📚 Recursos Úteis

- [Google Calendar API Docs](https://developers.google.com/calendar/api/v3/reference)
- [OAuth 2.0 Flow](https://developers.google.com/identity/protocols/oauth2)
- [React Router](https://reactrouter.com/) (para rotas)
- [Axios](https://axios-http.com/) (alternativa ao fetch)

---

**Última atualização:** Janeiro 2024

