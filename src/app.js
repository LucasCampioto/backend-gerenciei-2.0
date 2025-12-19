const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');

// Carregar variáveis de ambiente
dotenv.config();

const app = express();

// Middlewares
// Configuração de CORS mais permissiva para desenvolvimento
app.use(cors({
  origin: true, // Permite todas as origens
  credentials: true
}));

// Middleware para debug (temporário)
app.use((req, res, next) => {
  console.log('🔍 [EXPRESS] Request:', {
    method: req.method,
    url: req.url,
    path: req.path,
    originalUrl: req.originalUrl,
    baseUrl: req.baseUrl
  });
  next();
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Servir arquivos estáticos de uploads
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Rota de health check
app.get('/health', (req, res) => {
  res.json({ 
    success: true, 
    message: 'Server is running',
    timestamp: new Date().toISOString()
  });
});

// Importar rotas
const authRoutes = require('./routes/auth.routes');
const procedureRoutes = require('./routes/procedure.routes');
const employeeRoutes = require('./routes/employee.routes');
const saleRoutes = require('./routes/sale.routes');
const expenseRoutes = require('./routes/expense.routes');
const documentRoutes = require('./routes/document.routes');
const calendarRoutes = require('./routes/calendar.routes');

// Usar rotas com prefixo /api
app.use('/api/auth', authRoutes);
app.use('/api/procedures', procedureRoutes);
app.use('/api/employees', employeeRoutes);
app.use('/api/sales', saleRoutes);
app.use('/api/expenses', expenseRoutes);
app.use('/api/documents', documentRoutes);
app.use('/api/calendar', calendarRoutes);

// Rota 404 para API
app.use('/api', (req, res) => {
  res.status(404).json({
    success: false,
    error: 'Rota não encontrada'
  });
});

// Middleware de tratamento de erros
const { errorHandler } = require('./middleware/errorHandler.middleware');
app.use(errorHandler);

module.exports = app;
