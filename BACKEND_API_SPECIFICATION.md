# Especificação de API Backend - Node.js + MongoDB

## Visão Geral

Este documento especifica todas as rotas necessárias para implementar o backend da aplicação Signly, garantindo compatibilidade total com o front-end existente sem necessidade de alterações.

**Base URL**: `http://localhost:3000/api` (ou conforme configuração)

**Formato de Resposta Padrão**:
```json
{
  "success": true,
  "data": {},
  "message": "Operação realizada com sucesso"
}
```

**Formato de Erro Padrão**:
```json
{
  "success": false,
  "error": "Mensagem de erro",
  "details": {}
}
```

---

## Autenticação

Todas as rotas (exceto `/auth/login` e `/auth/signup`) devem incluir o token JWT no header:
```
Authorization: Bearer <token>
```

---

## 1. Autenticação (`/auth`)

### 1.1. POST `/auth/signup`
Registra um novo usuário.

**Request Body**:
```json
{
  "name": "string",
  "email": "string",
  "password": "string"
}
```

**Response** (201):
```json
{
  "success": true,
  "data": {
    "user": {
      "id": "string",
      "name": "string",
      "email": "string"
    },
    "token": "string"
  },
  "message": "Usuário criado com sucesso"
}
```

**Validações**:
- `name`: obrigatório, mínimo 3 caracteres
- `email`: obrigatório, formato de email válido, único
- `password`: obrigatório, mínimo 6 caracteres

---

### 1.2. POST `/auth/login`
Autentica um usuário existente.

**Request Body**:
```json
{
  "email": "string",
  "password": "string"
}
```

**Response** (200):
```json
{
  "success": true,
  "data": {
    "user": {
      "id": "string",
      "name": "string",
      "email": "string"
    },
    "token": "string"
  },
  "message": "Login realizado com sucesso"
}
```

**Erros**:
- 401: Email ou senha inválidos

---

### 1.3. POST `/auth/logout`
Invalida o token do usuário (opcional, pode ser apenas front-end).

**Response** (200):
```json
{
  "success": true,
  "message": "Logout realizado com sucesso"
}
```

---

### 1.4. GET `/auth/me`
Retorna os dados do usuário autenticado.

**Response** (200):
```json
{
  "success": true,
  "data": {
    "id": "string",
    "name": "string",
    "email": "string"
  }
}
```

---

## 2. Procedimentos (`/procedures`)

### 2.1. GET `/procedures`
Lista todos os procedimentos.

**Response** (200):
```json
{
  "success": true,
  "data": [
    {
      "id": "string",
      "name": "string",
      "description": "string",
      "value": 0,
      "createdAt": "2024-01-01T00:00:00.000Z"
    }
  ]
}
```

---

### 2.2. POST `/procedures`
Cria um novo procedimento.

**Request Body**:
```json
{
  "name": "string",
  "description": "string",
  "value": 0
}
```

**Response** (201):
```json
{
  "success": true,
  "data": {
    "id": "string",
    "name": "string",
    "description": "string",
    "value": 0,
    "createdAt": "2024-01-01T00:00:00.000Z"
  },
  "message": "Procedimento criado com sucesso"
}
```

**Validações**:
- `name`: obrigatório, mínimo 3 caracteres
- `description`: obrigatório
- `value`: obrigatório, número positivo

---

### 2.3. PUT `/procedures/:id`
Atualiza um procedimento existente.

**Request Body**:
```json
{
  "name": "string",
  "description": "string",
  "value": 0
}
```

**Response** (200):
```json
{
  "success": true,
  "data": {
    "id": "string",
    "name": "string",
    "description": "string",
    "value": 0,
    "createdAt": "2024-01-01T00:00:00.000Z"
  },
  "message": "Procedimento atualizado com sucesso"
}
```

**Erros**:
- 404: Procedimento não encontrado

---

### 2.4. DELETE `/procedures/:id`
Remove um procedimento.

**Response** (200):
```json
{
  "success": true,
  "message": "Procedimento removido com sucesso"
}
```

**Erros**:
- 404: Procedimento não encontrado

---

## 3. Colaboradores (`/employees`)

### 3.1. GET `/employees`
Lista todos os colaboradores.

**Response** (200):
```json
{
  "success": true,
  "data": [
    {
      "id": "string",
      "name": "string",
      "email": "string",
      "phone": "string",
      "generalCommission": 0,
      "procedureCommissions": [
        {
          "procedureId": "string",
          "percentage": 0
        }
      ],
      "createdAt": "2024-01-01T00:00:00.000Z"
    }
  ]
}
```

---

### 3.2. POST `/employees`
Cria um novo colaborador.

**Request Body**:
```json
{
  "name": "string",
  "email": "string",
  "phone": "string",
  "generalCommission": 0,
  "procedureCommissions": [
    {
      "procedureId": "string",
      "percentage": 0
    }
  ]
}
```

**Response** (201):
```json
{
  "success": true,
  "data": {
    "id": "string",
    "name": "string",
    "email": "string",
    "phone": "string",
    "generalCommission": 0,
    "procedureCommissions": [
      {
        "procedureId": "string",
        "percentage": 0
      }
    ],
    "createdAt": "2024-01-01T00:00:00.000Z"
  },
  "message": "Colaborador criado com sucesso"
}
```

**Validações**:
- `name`: obrigatório, mínimo 3 caracteres
- `email`: opcional, formato de email válido se fornecido
- `phone`: opcional
- `generalCommission`: obrigatório, número entre 0 e 100
- `procedureCommissions`: opcional, array de objetos
  - `procedureId`: obrigatório se array fornecido
  - `percentage`: obrigatório, número entre 0 e 100

---

### 3.3. PUT `/employees/:id`
Atualiza um colaborador existente.

**Request Body**:
```json
{
  "name": "string",
  "email": "string",
  "phone": "string",
  "generalCommission": 0,
  "procedureCommissions": [
    {
      "procedureId": "string",
      "percentage": 0
    }
  ]
}
```

**Response** (200):
```json
{
  "success": true,
  "data": {
    "id": "string",
    "name": "string",
    "email": "string",
    "phone": "string",
    "generalCommission": 0,
    "procedureCommissions": [
      {
        "procedureId": "string",
        "percentage": 0
      }
    ],
    "createdAt": "2024-01-01T00:00:00.000Z"
  },
  "message": "Colaborador atualizado com sucesso"
}
```

**Erros**:
- 404: Colaborador não encontrado

---

### 3.4. DELETE `/employees/:id`
Remove um colaborador.

**Response** (200):
```json
{
  "success": true,
  "message": "Colaborador removido com sucesso"
}
```

**Erros**:
- 404: Colaborador não encontrado

---

### 3.5. GET `/employees/:id/commission/:procedureId`
Retorna a comissão de um colaborador para um procedimento específico.

**Response** (200):
```json
{
  "success": true,
  "data": {
    "commission": 0
  }
}
```

**Lógica**:
- Se houver comissão específica para o procedimento, retorna ela
- Senão, retorna a comissão geral do colaborador
- Se colaborador não encontrado, retorna 0

---

## 4. Vendas (`/sales`)

### 4.1. GET `/sales`
Lista todas as vendas.

**Query Parameters** (opcionais):
- `startDate`: string (ISO date) - Data inicial para filtro
- `endDate`: string (ISO date) - Data final para filtro
- `employeeId`: string - Filtrar por colaborador

**Response** (200):
```json
{
  "success": true,
  "data": [
    {
      "id": "string",
      "items": [
        {
          "procedureId": "string",
          "procedureName": "string",
          "quantity": 0,
          "unitValue": 0,
          "totalValue": 0
        }
      ],
      "totalValue": 0,
      "commissionValue": 0,
      "netValue": 0,
      "employeeId": "string",
      "employeeName": "string",
      "createdAt": "2024-01-01T00:00:00.000Z"
    }
  ]
}
```

---

### 4.2. POST `/sales`
Cria uma nova venda.

**Request Body**:
```json
{
  "items": [
    {
      "procedureId": "string",
      "procedureName": "string",
      "quantity": 0,
      "unitValue": 0,
      "totalValue": 0
    }
  ],
  "totalValue": 0,
  "commissionValue": 0,
  "netValue": 0,
  "employeeId": "string",
  "employeeName": "string"
}
```

**Response** (201):
```json
{
  "success": true,
  "data": {
    "id": "string",
    "items": [
      {
        "procedureId": "string",
        "procedureName": "string",
        "quantity": 0,
        "unitValue": 0,
        "totalValue": 0
      }
    ],
    "totalValue": 0,
    "commissionValue": 0,
    "netValue": 0,
    "employeeId": "string",
    "employeeName": "string",
    "createdAt": "2024-01-01T00:00:00.000Z"
  },
  "message": "Venda criada com sucesso"
}
```

**Validações**:
- `items`: obrigatório, array não vazio
- `totalValue`: obrigatório, número positivo
- `employeeId`: opcional (para compatibilidade com vendas antigas)
- `employeeName`: opcional (para compatibilidade com vendas antigas)
- `commissionValue`: opcional, padrão 0 se não fornecido
- `netValue`: opcional, calculado como `totalValue - commissionValue` se não fornecido

**Nota**: O backend pode recalcular `commissionValue` e `netValue` baseado no `employeeId` e nos procedimentos, mas deve aceitar os valores enviados pelo front-end.

---

### 4.3. DELETE `/sales/:id`
Remove uma venda.

**Response** (200):
```json
{
  "success": true,
  "message": "Venda removida com sucesso"
}
```

**Erros**:
- 404: Venda não encontrada

---

### 4.4. GET `/sales/employee/:employeeId`
Lista vendas de um colaborador específico.

**Response** (200):
```json
{
  "success": true,
  "data": [
    {
      "id": "string",
      "items": [],
      "totalValue": 0,
      "commissionValue": 0,
      "netValue": 0,
      "employeeId": "string",
      "employeeName": "string",
      "createdAt": "2024-01-01T00:00:00.000Z"
    }
  ]
}
```

---

### 4.5. GET `/sales/employee/:employeeId/total`
Retorna o total de vendas de um colaborador.

**Response** (200):
```json
{
  "success": true,
  "data": {
    "total": 0
  }
}
```

---

## 5. Gastos (`/expenses`)

### 5.1. GET `/expenses`
Lista todos os gastos.

**Query Parameters** (opcionais):
- `startDate`: string (ISO date) - Data inicial para filtro
- `endDate`: string (ISO date) - Data final para filtro
- `category`: string - Filtrar por categoria

**Response** (200):
```json
{
  "success": true,
  "data": [
    {
      "id": "string",
      "description": "string",
      "value": 0,
      "category": "string",
      "createdAt": "2024-01-01T00:00:00.000Z"
    }
  ]
}
```

---

### 5.2. POST `/expenses`
Cria um novo gasto.

**Request Body**:
```json
{
  "description": "string",
  "value": 0,
  "category": "string"
}
```

**Response** (201):
```json
{
  "success": true,
  "data": {
    "id": "string",
    "description": "string",
    "value": 0,
    "category": "string",
    "createdAt": "2024-01-01T00:00:00.000Z"
  },
  "message": "Gasto criado com sucesso"
}
```

**Validações**:
- `description`: obrigatório, mínimo 3 caracteres
- `value`: obrigatório, número positivo
- `category`: obrigatório

---

### 5.3. PUT `/expenses/:id`
Atualiza um gasto existente.

**Request Body**:
```json
{
  "description": "string",
  "value": 0,
  "category": "string"
}
```

**Response** (200):
```json
{
  "success": true,
  "data": {
    "id": "string",
    "description": "string",
    "value": 0,
    "category": "string",
    "createdAt": "2024-01-01T00:00:00.000Z"
  },
  "message": "Gasto atualizado com sucesso"
}
```

**Erros**:
- 404: Gasto não encontrado

---

### 5.4. DELETE `/expenses/:id`
Remove um gasto.

**Response** (200):
```json
{
  "success": true,
  "message": "Gasto removido com sucesso"
}
```

**Erros**:
- 404: Gasto não encontrado

---

## 6. Documentos Assinados (`/documents`)

### 6.1. GET `/documents`
Lista todos os documentos assinados.

**Query Parameters** (opcionais):
- `search`: string - Busca por fileName, userName ou userEmail

**Response** (200):
```json
{
  "success": true,
  "data": [
    {
      "id": "string",
      "fileName": "string",
      "fileType": "string",
      "fileUrl": "string",
      "userName": "string",
      "userEmail": "string",
      "observations": "string",
      "signatureUrl": "string",
      "signedAt": "2024-01-01T00:00:00.000Z",
      "status": "Assinado"
    }
  ]
}
```

---

### 6.2. POST `/documents`
Cria um novo documento assinado.

**Request Body** (multipart/form-data ou JSON com base64):
```json
{
  "fileName": "string",
  "fileType": "string",
  "fileUrl": "string",
  "userName": "string",
  "userEmail": "string",
  "observations": "string",
  "signatureUrl": "string"
}
```

**Alternativa com arquivo** (multipart/form-data):
- `file`: File (arquivo assinado - PDF ou imagem)
- `fileName`: string
- `fileType`: string
- `userName`: string
- `userEmail`: string
- `observations`: string (opcional)

**Response** (201):
```json
{
  "success": true,
  "data": {
    "id": "string",
    "fileName": "string",
    "fileType": "string",
    "fileUrl": "string",
    "userName": "string",
    "userEmail": "string",
    "observations": "string",
    "signatureUrl": "string",
    "signedAt": "2024-01-01T00:00:00.000Z",
    "status": "Assinado"
  },
  "message": "Documento salvo com sucesso"
}
```

**Validações**:
- `fileName`: obrigatório
- `fileType`: obrigatório
- `fileUrl` ou `file`: obrigatório (um dos dois)
- `userName`: obrigatório
- `userEmail`: obrigatório, formato de email válido
- `signatureUrl`: obrigatório (URL do arquivo assinado)

**Nota**: O backend deve armazenar o arquivo assinado (PDF ou imagem) e retornar a URL onde ele está disponível. Pode usar serviços como AWS S3, Google Cloud Storage, ou armazenamento local.

---

### 6.3. GET `/documents/:id/download`
Faz download do documento assinado.

**Response** (200):
- Content-Type: conforme `fileType` (application/pdf ou image/png)
- Content-Disposition: attachment; filename="..."
- Body: arquivo binário

---

## Schemas MongoDB

### Collection: `users`
```javascript
{
  _id: ObjectId,
  name: String (required),
  email: String (required, unique, index),
  password: String (required, hashed),
  createdAt: Date (default: now),
  updatedAt: Date (default: now)
}
```

---

### Collection: `procedures`
```javascript
{
  _id: ObjectId,
  userId: ObjectId (required, ref: 'users', index),
  name: String (required),
  description: String (required),
  value: Number (required, min: 0),
  createdAt: Date (default: now),
  updatedAt: Date (default: now)
}
```

---

### Collection: `employees`
```javascript
{
  _id: ObjectId,
  userId: ObjectId (required, ref: 'users', index),
  name: String (required),
  email: String (optional),
  phone: String (optional),
  generalCommission: Number (required, min: 0, max: 100),
  procedureCommissions: [{
    procedureId: ObjectId (ref: 'procedures'),
    percentage: Number (min: 0, max: 100)
  }],
  createdAt: Date (default: now),
  updatedAt: Date (default: now)
}
```

---

### Collection: `sales`
```javascript
{
  _id: ObjectId,
  userId: ObjectId (required, ref: 'users', index),
  items: [{
    procedureId: ObjectId (ref: 'procedures'),
    procedureName: String (required),
    quantity: Number (required, min: 1),
    unitValue: Number (required, min: 0),
    totalValue: Number (required, min: 0)
  }],
  totalValue: Number (required, min: 0),
  commissionValue: Number (default: 0, min: 0),
  netValue: Number (required, min: 0),
  employeeId: ObjectId (optional, ref: 'employees'),
  employeeName: String (optional),
  createdAt: Date (default: now, index)
}
```

---

### Collection: `expenses`
```javascript
{
  _id: ObjectId,
  userId: ObjectId (required, ref: 'users', index),
  description: String (required),
  value: Number (required, min: 0),
  category: String (required),
  createdAt: Date (default: now, index),
  updatedAt: Date (default: now)
}
```

---

### Collection: `documents`
```javascript
{
  _id: ObjectId,
  userId: ObjectId (required, ref: 'users', index),
  fileName: String (required),
  fileType: String (required), // 'application/pdf' ou 'image/png'
  fileUrl: String (required), // URL do arquivo original
  signatureUrl: String (required), // URL do arquivo assinado
  userName: String (required),
  userEmail: String (required),
  observations: String (optional),
  signedAt: Date (default: now, index),
  status: String (default: 'Assinado')
}
```

---

## Middleware e Segurança

### 1. Autenticação JWT
- Todas as rotas (exceto `/auth/login` e `/auth/signup`) devem verificar o token JWT
- Token deve conter: `userId`, `email`
- Token expira em 7 dias (ou conforme configuração)

### 2. Validação de Dados
- Usar biblioteca de validação (ex: Joi, express-validator)
- Validar todos os campos obrigatórios
- Validar tipos e formatos (email, números, etc.)

### 3. Isolamento de Dados
- Todas as queries devem filtrar por `userId` para garantir que usuários só acessem seus próprios dados
- Usar middleware para adicionar `userId` automaticamente nas queries

### 4. Tratamento de Erros
- Retornar status HTTP apropriados (400, 401, 404, 500)
- Mensagens de erro claras e consistentes
- Não expor detalhes internos em produção

### 5. Upload de Arquivos
- Validar tipo de arquivo (PDF ou imagem)
- Validar tamanho máximo (ex: 10MB)
- Armazenar em local seguro (S3, Cloud Storage, ou pasta protegida)
- Gerar URLs seguras para acesso

---

## Códigos de Status HTTP

- `200`: Sucesso (GET, PUT, DELETE)
- `201`: Criado com sucesso (POST)
- `400`: Erro de validação ou requisição inválida
- `401`: Não autenticado (token inválido ou ausente)
- `403`: Não autorizado (sem permissão)
- `404`: Recurso não encontrado
- `500`: Erro interno do servidor

---

## Exemplo de Middleware de Autenticação

```javascript
const authenticate = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    
    if (!token) {
      return res.status(401).json({
        success: false,
        error: 'Token não fornecido'
      });
    }
    
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.userId = decoded.userId;
    req.userEmail = decoded.email;
    
    next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      error: 'Token inválido ou expirado'
    });
  }
};
```

---

## Exemplo de Middleware de Isolamento de Dados

```javascript
const addUserFilter = (req, res, next) => {
  // Adiciona userId automaticamente nas queries
  req.query.userId = req.userId;
  req.body.userId = req.userId;
  next();
};
```

---

## Notas Importantes

1. **IDs**: O front-end usa `id` como string. O MongoDB usa `_id` como ObjectId. Converter entre os dois formatos nas respostas.

2. **Datas**: O front-end espera objetos `Date` do JavaScript. MongoDB armazena como `Date`. Garantir que as respostas enviem datas no formato ISO string ou como objetos Date serializados.

3. **Compatibilidade**: Manter compatibilidade com dados antigos que podem não ter campos opcionais (ex: `employeeId` em vendas antigas).

4. **Cálculos**: O front-end já calcula `commissionValue` e `netValue`. O backend pode recalcular para validação, mas deve aceitar os valores enviados.

5. **Paginação**: Por enquanto, todas as listagens retornam todos os registros. Pode-se adicionar paginação no futuro se necessário.

6. **Upload de Arquivos**: Para documentos, considerar usar `multer` (Node.js) para upload de arquivos. Armazenar em serviço de storage ou localmente e retornar URL.

---

## Estrutura de Pastas Sugerida

```
backend/
├── src/
│   ├── controllers/
│   │   ├── auth.controller.js
│   │   ├── procedure.controller.js
│   │   ├── employee.controller.js
│   │   ├── sale.controller.js
│   │   ├── expense.controller.js
│   │   └── document.controller.js
│   ├── models/
│   │   ├── User.js
│   │   ├── Procedure.js
│   │   ├── Employee.js
│   │   ├── Sale.js
│   │   ├── Expense.js
│   │   └── Document.js
│   ├── routes/
│   │   ├── auth.routes.js
│   │   ├── procedure.routes.js
│   │   ├── employee.routes.js
│   │   ├── sale.routes.js
│   │   ├── expense.routes.js
│   │   └── document.routes.js
│   ├── middleware/
│   │   ├── auth.middleware.js
│   │   ├── validation.middleware.js
│   │   └── errorHandler.middleware.js
│   ├── utils/
│   │   ├── upload.js
│   │   └── helpers.js
│   └── app.js
├── uploads/ (ou configurar para S3/Cloud Storage)
├── .env
└── package.json
```

---

## Variáveis de Ambiente

```env
PORT=3000
MONGODB_URI=mongodb://localhost:27017/signly
JWT_SECRET=seu_secret_jwt_aqui
JWT_EXPIRES_IN=7d
NODE_ENV=development

# Para upload de arquivos (se usar S3)
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
AWS_BUCKET_NAME=
AWS_REGION=

# Ou para Google Cloud Storage
GOOGLE_CLOUD_PROJECT_ID=
GOOGLE_CLOUD_KEYFILE=
GOOGLE_CLOUD_BUCKET=
```

---

## Dependências Sugeridas (package.json)

```json
{
  "dependencies": {
    "express": "^4.18.2",
    "mongoose": "^7.0.0",
    "jsonwebtoken": "^9.0.0",
    "bcryptjs": "^2.4.3",
    "cors": "^2.8.5",
    "dotenv": "^16.0.3",
    "multer": "^1.4.5-lts.1",
    "joi": "^17.9.0",
    "express-validator": "^7.0.1"
  },
  "devDependencies": {
    "nodemon": "^2.0.22"
  }
}
```

---

**Fim da Especificação**

