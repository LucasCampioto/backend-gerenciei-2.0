const express = require('express');
const router = express.Router();
const {
  signup,
  login,
  logout,
  getMe,
  acceptTerms,
  changePassword,
} = require('../controllers/auth.controller');
const { validate } = require('../middleware/validation.middleware');
const { authenticate } = require('../middleware/auth.middleware');
const { loginSchema } = require('../validators/auth.validator');

router.post('/signup', signup);
router.post('/login', validate(loginSchema), login);
router.post('/logout', authenticate, logout);
router.get('/me', authenticate, getMe);
router.post('/accept-terms', authenticate, acceptTerms);
router.post('/password', authenticate, changePassword);
router.post('/change-password', authenticate, changePassword);

module.exports = router;
