const app = require("../app");
const { connectDatabase } = require("../config/database");

module.exports = async (req, res) => {
  try {
    // Log temporário para diagnóstico (remover depois)
    console.log("MONGODB_URI exists?", !!process.env.MONGODB_URI);
    console.log("MONGODB_URI starts with mongodb?", process.env.MONGODB_URI?.startsWith("mongodb"));
    
    await connectDatabase();      // garante conexão antes das rotas
    return app(req, res);         // Express lida com /api/auth, /api/...
  } catch (error) {
    console.error("❌ Error in Vercel handler:", error);
    return res.status(500).json({
      success: false,
      error: "Internal server error",
      message: error.message
    });
  }
};