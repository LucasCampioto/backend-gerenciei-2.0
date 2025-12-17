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
  }
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

