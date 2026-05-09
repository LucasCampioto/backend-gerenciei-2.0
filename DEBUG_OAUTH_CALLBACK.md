# Debug - OAuth Callback 404

## Problema
A rota `/api/calendar/oauth/callback` está retornando 404 na Vercel.

## Verificações Necessárias

### 1. Verificar se a rota está registrada corretamente
- ✅ Rota definida em `src/routes/calendar.routes.js`: `router.get('/oauth/callback', handleOAuthCallback)`
- ✅ Rota registrada em `src/app.js`: `app.use('/api/calendar', calendarRoutes)`
- ✅ Handler em `api/index.js` passa requisição para Express

### 2. Verificar logs na Vercel
Após fazer deploy, verifique os logs:
- Procure por: `📥 Request received:`
- Procure por: `🔔 [OAUTH CALLBACK] Recebido:`

Se não aparecer nenhum log, a requisição não está chegando no handler.

### 3. Verificar vercel.json
O `vercel.json` está configurado para redirecionar tudo para `/api/index.js`:
```json
{
    "rewrites": [
      { "source": "/(.*)", "destination": "/api/index.js" }
    ]
}
```

Isso deveria funcionar, mas pode haver um problema.

### 4. Possíveis soluções

#### Solução 1: Verificar se o caminho está correto
A URL que chega pode estar diferente. Os logs vão mostrar isso.

#### Solução 2: Criar função serverless específica
Criar `api/calendar/oauth/callback.js` como função serverless separada.

#### Solução 3: Ajustar vercel.json
Pode ser necessário ajustar o rewrite para lidar melhor com rotas específicas.

### 5. Verificar variáveis de ambiente
Certifique-se de que `FRONTEND_URL` está configurado na Vercel:
```bash
vercel env add FRONTEND_URL production
# Digite: https://seu-frontend.vercel.app
```

### 6. Testar localmente
```bash
vercel dev
# Acesse: http://localhost:3000/api/calendar/oauth/callback?code=test&state=test
```

## Próximos Passos

1. Fazer deploy e verificar logs
2. Se não aparecer nenhum log, o problema está no vercel.json ou no caminho
3. Se aparecer log mas não chegar no callback, o problema está no roteamento do Express
4. Compartilhar os logs para diagnóstico mais preciso

