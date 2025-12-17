const mongoose = require('mongoose');

async function connectDatabase() {
  try {
    const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/signly';
    
    // Opções de conexão para MongoDB Atlas
    const options = {
      serverSelectionTimeoutMS: 30000, // Timeout de 30 segundos para seleção de servidor
      socketTimeoutMS: 45000, // Timeout de 45 segundos para operações de socket
      connectTimeoutMS: 30000, // Timeout de 30 segundos para conexão inicial
      maxPoolSize: 10, // Número máximo de conexões no pool
      retryWrites: true, // Habilitar retry de writes
      w: 'majority' // Write concern
    };

    await mongoose.connect(MONGODB_URI, options);
    
    console.log('✅ Connected to MongoDB');
    
    // Tratamento de eventos de conexão
    mongoose.connection.on('error', (err) => {
      console.error('❌ MongoDB connection error:', err);
    });

    mongoose.connection.on('disconnected', () => {
      console.warn('⚠️ MongoDB disconnected');
    });

    mongoose.connection.on('reconnected', () => {
      console.log('✅ MongoDB reconnected');
    });
  } catch (error) {
    console.error('❌ MongoDB connection error:', error);
    throw error;
  }
}

module.exports = {
  connectDatabase
};

