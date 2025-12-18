const mongoose = require("mongoose");

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/signly';

// Cache para reutilizar conexão entre invocações (warm Lambda)
let cached = global.__mongoose;
if (!cached) {
  cached = global.__mongoose = { conn: null, promise: null };
}

async function connectDatabase() {
  // Em Lambdas, verificar se já está conectado (warm invocation)
  if (cached.conn) {
    // Verificar se a conexão ainda está ativa
    const readyState = mongoose.connection.readyState;
    if (readyState === 1) {
      // Conectado e pronto
      return cached.conn;
    }
    // Se a conexão foi fechada, limpar cache e reconectar
    if (readyState === 0 || readyState === 3) {
      cached.conn = null;
      cached.promise = null;
    }
  }

  // Se já está conectando (evita múltiplas conexões simultâneas)
  if (cached.promise) {
    try {
      cached.conn = await cached.promise;
      return cached.conn;
    } catch (error) {
      // Se falhou, limpar e tentar novamente
      cached.promise = null;
      cached.conn = null;
      throw error;
    }
  }

  // Iniciar nova conexão (cold start ou após falha)
  cached.promise = mongoose.connect(MONGODB_URI, {
    maxPoolSize: 5, // Pool pequeno para serverless
    serverSelectionTimeoutMS: 10000, // Timeout menor para falhar rápido em caso de problema
    socketTimeoutMS: 45000,
    connectTimeoutMS: 10000,
    bufferCommands: true, // CRÍTICO: bufferiza comandos até conexão estar pronta
    // Opções importantes para serverless
    keepAlive: true,
    keepAliveInitialDelay: 30000,
  });

  try {
    cached.conn = await cached.promise;
    console.log("✅ Connected to MongoDB");
    return cached.conn;
  } catch (error) {
    // Limpar cache em caso de erro
    cached.promise = null;
    cached.conn = null;
    console.error("❌ MongoDB connection error:", error);
    throw error;
  }
}

module.exports = { connectDatabase };