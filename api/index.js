const app = require("../src/app");
const { connectDatabase } = require("../src/config/database");
const mongoose = require("mongoose");

module.exports = async (req, res) => {
  try {
    // Log temporário para diagnóstico (remover depois)
    console.log("MONGODB_URI exists?", !!process.env.MONGODB_URI);
    console.log("MongoDB readyState before connect:", mongoose.connection.readyState);
    
    // Garantir conexão antes das rotas (essencial em Lambdas)
    await connectDatabase();
    
    console.log("MongoDB readyState after connect:", mongoose.connection.readyState);
    
    // Passar requisição para Express
    return app(req, res);
  } catch (error) {
    console.error("❌ Error in Vercel handler:", error);
    console.error("Error stack:", error.stack);
    return res.status(500).json({
      success: false,
      error: "Internal server error",
      message: process.env.NODE_ENV === 'production' ? 'Internal server error' : error.message
    });
  }
};


