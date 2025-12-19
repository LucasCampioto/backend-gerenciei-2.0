const { connectDatabase } = require('../../../src/config/database');
const { handleOAuthCallback } = require('../../../src/controllers/calendarOAuth.controller');
const { URL } = require('url');

module.exports = async (req, res) => {
  try {
    console.log('🎯 [CALLBACK FUNCTION] Recebido:', {
      method: req.method,
      url: req.url,
      query: req.query,
      host: req.headers.host
    });

    // Garantir conexão com banco de dados
    await connectDatabase();

    // Parsear query params manualmente (Vercel não faz isso automaticamente)
    let parsedQuery = {};
    if (req.url && req.url.includes('?')) {
      try {
        const fullUrl = `https://${req.headers.host || 'localhost'}${req.url}`;
        const urlObj = new URL(fullUrl);
        urlObj.searchParams.forEach((value, key) => {
          parsedQuery[key] = value;
        });
        console.log('📋 [CALLBACK FUNCTION] Query params parseados:', parsedQuery);
      } catch (parseError) {
        console.warn('⚠️ [CALLBACK FUNCTION] Erro ao parsear query params:', parseError.message);
        parsedQuery = req.query || {};
      }
    } else {
      parsedQuery = req.query || {};
    }

    // Criar objetos req/res compatíveis com Express
    const expressReq = {
      ...req,
      query: parsedQuery,
      method: req.method,
      url: req.url,
      path: '/api/calendar/oauth/callback'
    };

    const expressRes = {
      ...res,
      redirect: (url) => {
        console.log('🔄 [CALLBACK FUNCTION] Redirecionando para:', url);
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

    // Chamar o handler do controller
    return handleOAuthCallback(expressReq, expressRes, (err) => {
      if (err) {
        console.error('❌ [CALLBACK FUNCTION] Erro no callback:', err);
        res.statusCode = 500;
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
  } catch (error) {
    console.error('❌ [CALLBACK FUNCTION] Erro no handler:', error);
    console.error('Stack:', error.stack);
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({
      success: false,
      error: 'Internal server error',
      message: process.env.NODE_ENV === 'production' ? 'Internal server error' : error.message
    }));
  }
};

