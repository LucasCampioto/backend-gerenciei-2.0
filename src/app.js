const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');
const { URL } = require('url');

dotenv.config();

const app = express();

app.use(cors({
  origin: true,
  credentials: true
}));

app.use((req, res, next) => {
  if (req.url && req.url.includes('?')) {
    try {
      const fullUrl = `https://${req.headers.host || 'localhost'}${req.url}`;
      const urlObj = new URL(fullUrl);
      const parsedQuery = {};
      urlObj.searchParams.forEach((value, key) => {
        parsedQuery[key] = value;
      });
      if (Object.keys(parsedQuery).length > 0 || !req.query || Object.keys(req.query).length === 0) {
        req.query = parsedQuery;
      }
    } catch (error) {
      console.warn('Failed to parse query params:', error.message);
    }
  }
  next();
});

app.use((req, res, next) => {
  // Never log headers (Authorization / cookies) or full query (OAuth codes).
  console.log(`${req.method} ${req.path || req.url?.split('?')[0] || ''}`);
  next();
});

const { stripeWebhookHandler } = require('./routes/stripeWebhook.routes');

/** Stripe webhook MUST use raw body BEFORE express.json (signature verification). */
app.post(
  '/api/stripe/webhook',
  express.raw({ type: 'application/json' }),
  (req, res) => {
    void stripeWebhookHandler(req, res);
  },
);

app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true }));

const JWT_SECRET = process.env.JWT_SECRET;
const { createBillingLockGuard } = require('./middleware/billingLock.middleware');
const { createTermsAcceptanceGuard } = require('./middleware/termsAcceptance.middleware');
const { createPlanEntitlementsGuard } = require('./middleware/planEntitlements.middleware');

if (JWT_SECRET) {
  app.use(createBillingLockGuard(JWT_SECRET));
  app.use(createTermsAcceptanceGuard(JWT_SECRET));
  app.use(createPlanEntitlementsGuard(JWT_SECRET));
} else {
  console.warn('⚠️ JWT_SECRET ausente — billing/terms/plan guards não aplicados');
}

app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

app.get('/health', (req, res) => {
  res.json({
    success: true,
    message: 'Server is running',
    timestamp: new Date().toISOString()
  });
});

const authRoutes = require('./routes/auth.routes');
const procedureRoutes = require('./routes/procedure.routes');
const employeeRoutes = require('./routes/employee.routes');
const clientRoutes = require('./routes/client.routes');
const saleRoutes = require('./routes/sale.routes');
const expenseRoutes = require('./routes/expense.routes');
const stockItemRoutes = require('./routes/stockItem.routes');
const documentRoutes = require('./routes/document.routes');
const calendarRoutes = require('./routes/calendar.routes');
const reportsRoutes = require('./routes/reports.routes');
const paymentFeeRoutes = require('./routes/paymentFee.routes');
const crmRoutes = require('./routes/crm.routes');
const formRoutes = require('./routes/form.routes');
const publicFormRoutes = require('./routes/publicForm.routes');
const homeRoutes = require('./routes/home.routes');
const onboardingRoutes = require('./routes/onboarding.routes');
const commercialRoutes = require('./routes/commercial.routes');
const internalRoutes = require('./routes/internal.routes');
const whatsappRoutes = require('./routes/whatsapp.routes');
const whatsappCronRoutes = require('./routes/whatsappCron.routes');
const subscriptionRoutes = require('./routes/subscription.routes');
const adminSimulationRoutes = require('./routes/adminSimulation.routes');
const enhanceRoutes = require('./routes/enhance.routes');
const enhancePairsRoutes = require('./routes/enhancePairs.routes');
const simulationRoutes = require('./routes/simulation.routes');

app.use(enhanceRoutes);

app.use('/api/auth', authRoutes);
app.use('/api/procedures', procedureRoutes);
app.use('/api/employees', employeeRoutes);
app.use('/api/clients', clientRoutes);
app.use('/api/sales', saleRoutes);
app.use('/api/expenses', expenseRoutes);
app.use('/api/stock-items', stockItemRoutes);
app.use('/api/documents', documentRoutes);
app.use('/api/calendar', calendarRoutes);
app.use('/api/reports', reportsRoutes);
app.use('/api/payment-fees', paymentFeeRoutes);
app.use('/api/crm', crmRoutes);
app.use('/api/forms', formRoutes);
app.use('/api/public/forms', publicFormRoutes);
app.use('/api/campaigns', require('./routes/campaign.routes'));
app.use('/api/public/campaigns', require('./routes/publicCampaign.routes'));
app.use('/api/marketing', require('./routes/marketing.routes'));
app.use('/api/home', homeRoutes);
app.use('/api/onboarding', onboardingRoutes);
app.use('/api/commercial', commercialRoutes);
app.use('/api/internal', internalRoutes);
app.use('/api/internal/whatsapp', whatsappCronRoutes);
app.use('/api/whatsapp', whatsappRoutes);
app.use('/api/subscriptions', subscriptionRoutes);
app.use('/api/admin', adminSimulationRoutes);
app.use('/api', enhancePairsRoutes);
app.use('/api', simulationRoutes);
app.use('/api', require('./routes/pricingBases.routes'));

app.use('/api', (req, res) => {
  res.status(404).json({
    success: false,
    error: 'Rota não encontrada'
  });
});

const { errorHandler } = require('./middleware/errorHandler.middleware');
app.use(errorHandler);

module.exports = app;
