const app = require("../../../src/app");
const { connectDatabase } = require("../../../src/config/database");
const mongoose = require("mongoose");

module.exports = async (req, res) => {
  try {
    console.log("🔔 [OAUTH CALLBACK HANDLER] Recebido:", {
      method: req.method,
      url: req.url,
      query: req.query
    });
    
    // Garantir conexão antes das rotas (essencial em Lambdas)
    await connectDatabase();
    
    // Passar requisição para Express
    // O Express vai processar a rota /api/calendar/oauth/callback
    return app(req, res);
  } catch (error) {
    console.error("❌ Error in OAuth callback handler:", error);
    console.error("Error stack:", error.stack);
    return res.status(500).json({
      success: false,
      error: "Internal server error",
      message: process.env.NODE_ENV === 'production' ? 'Internal server error' : error.message
    });
  }
};

