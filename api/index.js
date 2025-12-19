const app = require("../src/app");
const { connectDatabase } = require("../src/config/database");
const mongoose = require("mongoose");

module.exports = async (req, res) => {
  try {
    // Log temporário para diagnóstico (remover depois)
    console.log("📥 Request received:", req.method, req.url);
    console.log("📥 Original URL:", req.url);
    console.log("📥 Path:", req.path);
    console.log("📥 Query:", req.query);
    console.log("📥 Headers:", JSON.stringify(req.headers));
    
    // Verificar se é a rota de callback OAuth e processar diretamente se necessário
    if (req.url.includes('/api/calendar/oauth/callback') || req.url.includes('/calendar/oauth/callback')) {
      console.log("🎯 Detectado callback OAuth, processando diretamente...");
      
      // Garantir conexão antes das rotas (essencial em Lambdas)
      await connectDatabase();
      
      // Importar e chamar o handler diretamente
      const { handleOAuthCallback } = require('../src/controllers/calendarOAuth.controller');
      
      // Criar objetos req/res compatíveis com Express
      const expressReq = {
        ...req,
        query: req.query || {},
        method: req.method
      };
      
      const expressRes = {
        ...res,
        redirect: (url) => {
          console.log("🔄 Redirecionando para:", url);
          res.writeHead(302, { Location: url });
          res.end();
        },
        status: (code) => ({
          json: (data) => {
            res.statusCode = code;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(data));
          }
        }),
        json: (data) => {
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(data));
        }
      };
      
      return handleOAuthCallback(expressReq, expressRes, (err) => {
        if (err) {
          console.error("❌ Erro no callback:", err);
          res.statusCode = 500;
          res.end(JSON.stringify({ success: false, error: err.message }));
        }
      });
    }
    
    console.log("MONGODB_URI exists?", !!process.env.MONGODB_URI);
    console.log("JWT_SECRET exists?", !!process.env.JWT_SECRET);
    console.log("MongoDB readyState before connect:", mongoose.connection.readyState);
    
    // Garantir conexão antes das rotas (essencial em Lambdas)
    await connectDatabase();
    
    console.log("MongoDB readyState after connect:", mongoose.connection.readyState);
    
    // Passar requisição para Express
    // O Express deve receber a URL completa
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


