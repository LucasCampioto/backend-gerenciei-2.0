const mongoose = require('mongoose');

async function connectDatabase() {
  try {
    const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/signly';
    
    await mongoose.connect(MONGODB_URI);
    
    console.log('✅ Connected to MongoDB');
  } catch (error) {
    console.error('❌ MongoDB connection error:', error);
    throw error;
  }
}

module.exports = {
  connectDatabase
};

