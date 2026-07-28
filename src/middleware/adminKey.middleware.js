/** Admin API: enviar header `x-admin-key` igual a `ADMIN_API_KEY`. */
function createRequireAdmin() {
  return function requireAdmin(req, res, next) {
    const key = (process.env.ADMIN_API_KEY || '').trim();
    if (!key) {
      res.status(503).json({ message: 'Administração não configurada (ADMIN_API_KEY)' });
      return;
    }
    const provided = String(req.headers['x-admin-key'] || '').trim();
    if (provided !== key) {
      res.status(401).json({ message: 'Não autorizado' });
      return;
    }
    next();
  };
}

module.exports = { createRequireAdmin };
