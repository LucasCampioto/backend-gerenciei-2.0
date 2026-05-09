# Instruções de Agente — JavaScript Funcional e Simples

## Princípios Centrais
**KISS (Keep It Simple, Stupid)** — o código deve ser direto, legível e fácil de manter. Evite abstrações desnecessárias e padrões complexos.

## Regras
- **Sem classes, sem factories** → apenas funções simples e diretas  
- **Uma responsabilidade por arquivo** → um propósito claro por módulo  
- **Funções puras por padrão** → isole I/O em `adapters/` ou `services/`  
- **Composição simples** → combine funções pequenas de forma direta  
- **Parâmetros explícitos** → passe dependências como parâmetros quando necessário  
- **Nomes claros** → descritivos e autoexplicativos  
- **Comentários em português** → comentários concisos em português quando necessário 

## Antipadrões a Evitar

❌ **Superabstração**
```js
const makeUserFactory = (deps) => makeService(deps)(makeUserMethods);
```

✅ **Mantenha simples**
```js
async function createUser(name, email) { /* ... */ }
```

❌ **Wrappers desnecessários**
```js
const withErrorHandler = (fn) => async (...args) => { /* ... */ };
```

✅ **Trate erros diretamente**
```js
async function handler(event) {
  try { /* ... */ }
  catch (error) { /* ... */ }
}
```

## Checklist de Saída
- [ ] Sem classes ou factories  
- [ ] Funções simples e diretas  
- [ ] Um propósito claro por arquivo    
- [ ] Parâmetros explícitos  
- [ ] Nomes descritivos  
- [ ] Fácil de testar  
- [ ] Fácil de entender e manter  
