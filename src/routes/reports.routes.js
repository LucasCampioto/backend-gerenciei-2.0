const express = require('express');
const router = express.Router();
const { getAnnualBalance } = require('../controllers/annualBalance.controller');
const {
  getMonthlyRevenue,
  getSalesByProcedure,
  getExecutiveDashboard,
  getEmployeePerformance,
  getPaymentMethods,
  getMonthComparison,
  getProceduresByPaymentMethod,
} = require('../controllers/financialReports.controller');
const {
  getSeasonality,
  getProcedureMix,
  getCalendarOccupancy,
} = require('../controllers/insightsReports.controller');
const {
  getProceduresByClient,
  getClientRecurrence,
  getLeadConversionFunnel,
} = require('../controllers/clientReports.controller');
const { getBusinessHealth } = require('../controllers/businessHealth.controller');
const { authenticate } = require('../middleware/auth.middleware');

router.use(authenticate);

router.get('/business-health', getBusinessHealth);
router.get('/annual-balance', getAnnualBalance);
router.get('/monthly-revenue', getMonthlyRevenue);
router.get('/sales-by-procedure', getSalesByProcedure);
router.get('/executive-dashboard', getExecutiveDashboard);
router.get('/employee-performance', getEmployeePerformance);
router.get('/payment-methods', getPaymentMethods);
router.get('/procedures-by-payment-method', getProceduresByPaymentMethod);
router.get('/month-comparison', getMonthComparison);
router.get('/seasonality', getSeasonality);
router.get('/procedure-mix', getProcedureMix);
router.get('/calendar-occupancy', getCalendarOccupancy);
router.get('/procedures-by-client', getProceduresByClient);
router.get('/client-recurrence', getClientRecurrence);
router.get('/lead-conversion-funnel', getLeadConversionFunnel);

module.exports = router;
