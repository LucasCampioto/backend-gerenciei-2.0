const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');
const { URL } = require('url');

// Carregar variáveis de ambiente
dotenv.config();

const app = express();

// Middlewares
// Configuração de CORS mais permissiva para desenvolvimento
app.use(cors({
  origin: true, // Permite todas as origens
  credentials: true
}));

// Middleware para parsear query params manualmente (necessário na Vercel)
app.use((req, res, next) => {
  // Se houver query params na URL, sempre parsear manualmente (Vercel não faz isso corretamente)
  if (req.url && req.url.includes('?')) {
    try {
      const fullUrl = `https://${req.headers.host || 'localhost'}${req.url}`;
      const urlObj = new URL(fullUrl);
      const parsedQuery = {};
      urlObj.searchParams.forEach((value, key) => {
        parsedQuery[key] = value;
      });
      // Só sobrescrever se realmente parseou algo ou se req.query estava vazio
      if (Object.keys(parsedQuery).length > 0 || !req.query || Object.keys(req.query).length === 0) {
        req.query = parsedQuery;
        console.log('📋 [EXPRESS] Query params parseados manualmente:', req.query);
      }
    } catch (error) {
      console.warn('⚠️ [EXPRESS] Erro ao parsear query params:', error.message);
    }
  }
  next();
});

// Middleware para debug (temporário)
app.use((req, res, next) => {
  console.log('🔍 [EXPRESS] Request:', {
    method: req.method,
    url: req.url,
    path: req.path,
    originalUrl: req.originalUrl,
    baseUrl: req.baseUrl,
    query: req.query
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
const clientRoutes = require('./routes/client.routes');
const saleRoutes = require('./routes/sale.routes');
const expenseRoutes = require('./routes/expense.routes');
const documentRoutes = require('./routes/document.routes');
const calendarRoutes = require('./routes/calendar.routes');
const reportsRoutes = require('./routes/reports.routes');
const paymentFeeRoutes = require('./routes/paymentFee.routes');
const crmRoutes = require('./routes/crm.routes');
const formRoutes = require('./routes/form.routes');
const publicFormRoutes = require('./routes/publicForm.routes');
const homeRoutes = require('./routes/home.routes');
const onboardingRoutes = require('./routes/onboarding.routes');

// Usar rotas com prefixo /api
app.use('/api/auth', authRoutes);
app.use('/api/procedures', procedureRoutes);
app.use('/api/employees', employeeRoutes);
app.use('/api/clients', clientRoutes);
app.use('/api/sales', saleRoutes);
app.use('/api/expenses', expenseRoutes);
app.use('/api/documents', documentRoutes);
app.use('/api/calendar', calendarRoutes);
app.use('/api/reports', reportsRoutes);
app.use('/api/payment-fees', paymentFeeRoutes);
app.use('/api/crm', crmRoutes);
app.use('/api/forms', formRoutes);
app.use('/api/public/forms', publicFormRoutes);
app.use('/api/home', homeRoutes);
app.use('/api/onboarding', onboardingRoutes);

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
