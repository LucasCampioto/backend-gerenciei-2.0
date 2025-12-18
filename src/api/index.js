const app = require("../src/app");
const { connectDatabase } = require("../config/database");

module.exports = async (req, res) => {
  await connectDatabase();      // garante conexão antes das rotas
  return app(req, res);         // Express lida com /api/auth, /api/...
};