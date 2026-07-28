const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
    index: true
  },
  password: {
    type: String,
    required: true
  },
  // Google Calendar OAuth2
  googleCalendarConnected: {
    type: Boolean,
    default: false,
    index: true
  },
  googleRefreshToken: {
    type: String,
    default: null
  },
  googleAccessToken: {
    type: String,
    default: null
  },
  googleTokenExpiry: {
    type: Date,
    default: null
  },
  googleCalendarEmail: {
    type: String,
    default: null
  },
  googleCalendarId: {
    type: String,
    default: null
  },
  googleCalendarName: {
    type: String,
    default: null
  },
  onboardingCompleted: {
    type: Boolean,
    default: false,
  },
  clinic: {
    type: String,
    default: '',
    trim: true,
  },
  phone: {
    type: String,
    default: '',
    trim: true,
  },
  notifEmail: {
    type: Boolean,
    default: true,
  },
  notifSms: {
    type: Boolean,
    default: false,
  },
  firstAccess: {
    type: Boolean,
    default: false,
  },
  stripeCustomerId: {
    type: String,
    trim: true,
    sparse: true,
    unique: true,
  },
  stripeSubscriptionId: {
    type: String,
    trim: true,
    sparse: true,
    unique: true,
  },
  subscriptionStatus: {
    type: String,
    default: '',
    trim: true,
  },
  trialEndsAt: {
    type: Date,
    default: null,
  },
  currentPeriodEnd: {
    type: Date,
    default: null,
  },
  cancelAtPeriodEnd: {
    type: Boolean,
    default: false,
  },
  simulationMonthlyQuota: {
    type: Number,
    default: 0,
  },
  simulationCreditsRemaining: {
    type: Number,
    default: 0,
  },
  simulationQuotaPeriodKey: {
    type: String,
    default: '',
  },
  previewMonthlyQuota: {
    type: Number,
    default: 0,
  },
  previewCreditsRemaining: {
    type: Number,
    default: 0,
  },
  previewQuotaPeriodKey: {
    type: String,
    default: '',
  },
  accountType: {
    type: String,
    enum: ['official', 'partner_test'],
    default: 'official',
  },
  partnerTestExpiresAt: {
    type: Date,
    default: null,
  },
  termsAcceptedAt: {
    type: Date,
    default: null,
  },
  privacyAcceptedAt: {
    type: Date,
    default: null,
  },
  termsVersion: {
    type: String,
    default: '',
  },
  patientDataResponsibilityAckAt: {
    type: Date,
    default: null,
  },
}, {
  timestamps: true
});

// Hash password antes de salvar
userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  
  try {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (error) {
    next(error);
  }
});

// Método para comparar senhas
userSchema.methods.comparePassword = async function(candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

// Remover campos sensíveis do JSON
userSchema.methods.toJSON = function() {
  const user = this.toObject();
  delete user.password;
  delete user.googleRefreshToken;
  delete user.googleAccessToken;
  return user;
};

module.exports = mongoose.model('User', userSchema);

