const app = require("../src/app");
const { connectDatabase } = require("../src/config/database");
const mongoose = require("mongoose");
const { URL } = require("url");

module.exports = async (req, res) => {
  try {
    const urlPath = req.url ? req.url.split('?')[0] : '';
    const isOAuthCallback =
      urlPath === '/api/calendar/oauth/callback' ||
      urlPath === '/calendar/oauth/callback' ||
      req.url?.includes('/api/calendar/oauth/callback') ||
      req.url?.includes('/calendar/oauth/callback');

    // Verificar se é a rota de callback OAuth e processar diretamente se necessário
    if (isOAuthCallback) {
      await connectDatabase();

      const { handleOAuthCallback } = require('../src/controllers/calendarOAuth.controller');

      let parsedQuery = {};
      try {
        const fullUrl = `https://${req.headers.host || 'localhost'}${req.url}`;
        const urlObj = new URL(fullUrl);
        urlObj.searchParams.forEach((value, key) => {
          parsedQuery[key] = value;
        });
      } catch (parseError) {
        console.warn('OAuth callback: failed to parse query', parseError.message);
        parsedQuery = req.query || {};
      }

      const expressReq = {
        ...req,
        query: parsedQuery,
        method: req.method,
        url: req.url
      };

      const expressRes = {
        ...res,
        redirect: (url) => {
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
          console.error('OAuth callback error');
          res.statusCode = 500;
          res.end(JSON.stringify({ success: false, error: 'Internal server error' }));
        }
      });
    }

    await connectDatabase();

    return app(req, res);
  } catch (error) {
    console.error('Vercel handler error');
    return res.status(500).json({
      success: false,
      error: "Internal server error",
      message: process.env.NODE_ENV === 'production' ? 'Internal server error' : error.message
    });
  }
};
