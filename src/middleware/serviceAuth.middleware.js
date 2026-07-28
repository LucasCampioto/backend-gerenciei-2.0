/**
 * Auth service-to-service para o Agno chamar o Node.
 * Aceita header X-Service-Key === AGNO_SERVICE_KEY.
 */
function authenticateService(req, res, next) {
  const configured = process.env.AGNO_SERVICE_KEY;
  if (!configured) {
    return res.status(503).json({
      success: false,
      error: 'AGNO_SERVICE_KEY não configurada',
    });
  }

  const key = req.headers['x-service-key'];
  if (!key || key !== configured) {
    return res.status(401).json({
      success: false,
      error: 'Chave de serviço inválida',
    });
  }

  const userId = req.headers['x-user-id'];
  if (!userId) {
    return res.status(400).json({
      success: false,
      error: 'Header X-User-Id é obrigatório',
    });
  }

  req.userId = userId;
  req.isServiceCall = true;
  next();
}

module.exports = { authenticateService };
