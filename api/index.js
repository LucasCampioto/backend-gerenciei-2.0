const app = require("../src/app");
const { connectDatabase } = require("../src/config/database");
const mongoose = require("mongoose");
const { URL } = require("url");

module.exports = async (req, res) => {
  try {
    // Log temporário para diagnóstico (remover depois)
    console.log("📥 Request received:", req.method, req.url);
    console.log("📥 Original URL:", req.url);
    console.log("📥 Path:", req.path);
    console.log("📥 Query:", req.query);
    console.log("📥 Headers:", JSON.stringify(req.headers));
    
    // Normalizar URL para comparação (remover query params temporariamente)
    const urlPath = req.url ? req.url.split('?')[0] : '';
    const isOAuthCallback = 
      urlPath === '/api/calendar/oauth/callback' ||
      urlPath === '/calendar/oauth/callback' ||
      req.url?.includes('/api/calendar/oauth/callback') ||
      req.url?.includes('/calendar/oauth/callback');
    
    console.log("🔍 Verificando OAuth callback:", {
      urlPath,
      originalUrl: req.url,
      isOAuthCallback
    });
    
    // Verificar se é a rota de callback OAuth e processar diretamente se necessário
    if (isOAuthCallback) {
      console.log("🎯 Detectado callback OAuth, processando diretamente...");
      
      // Garantir conexão antes das rotas (essencial em Lambdas)
      await connectDatabase();
      
      // Importar e chamar o handler diretamente
      const { handleOAuthCallback } = require('../src/controllers/calendarOAuth.controller');
      
      // Parsear query params manualmente da URL (Vercel não faz isso automaticamente)
      let parsedQuery = {};
      try {
        // Construir URL completa para parsear query params
        const fullUrl = `https://${req.headers.host || 'localhost'}${req.url}`;
        const urlObj = new URL(fullUrl);
        // Converter URLSearchParams para objeto simples
        urlObj.searchParams.forEach((value, key) => {
          parsedQuery[key] = value;
        });
        console.log("📋 Query params parseados:", parsedQuery);
      } catch (parseError) {
        console.warn("⚠️ Erro ao parsear query params, usando req.query:", parseError.message);
        parsedQuery = req.query || {};
      }
      
      // Criar objetos req/res compatíveis com Express
      const expressReq = {
        ...req,
        query: parsedQuery, // Usar query params parseados manualmente
        method: req.method,
        url: req.url
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


