const express = require('express');
const router = express.Router();
const {
  signup,
  login,
  logout,
  getMe,
  acceptTerms,
  changePassword,
  forgotPassword,
  resetPassword,
  previewInvite,
  acceptInviteHandler,
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

router.post('/forgot-password', forgotPassword);
router.post('/reset-password', resetPassword);

router.get('/invite/preview', previewInvite);
router.post('/invite/accept', acceptInviteHandler);

module.exports = router;
