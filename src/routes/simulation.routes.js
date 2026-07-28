const { Router } = require('express');
const {
  listSimulations,
  createSimulation,
  deleteSimulation,
  patchSimulation,
} = require('../services/simulation/simulations');
const { authenticate } = require('../middleware/auth.middleware');

const router = Router();
router.use(authenticate);

router.get('/simulations', async (req, res) => {
  try {
    const { clientId, patientId, procedure, from, to } = req.query;
    const list = await listSimulations(req.userId, { clientId, patientId, procedure, from, to });
    res.json(list);
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: 'Erro ao listar simulações' });
  }
});

router.post('/simulations', async (req, res) => {
  try {
    const result = await createSimulation(req.userId, req.body || {});
    if (result.error) {
      res.status(result.status || 400).json({ message: result.error });
      return;
    }
    res.status(201).json(result.simulation);
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: 'Erro ao criar simulação' });
  }
});

router.patch('/simulations/:id', async (req, res) => {
  try {
    const result = await patchSimulation(req.userId, req.params.id, req.body || {});
    if (result.error) {
      res.status(result.status || 400).json({ message: result.error });
      return;
    }
    res.json(result.simulation);
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: 'Erro ao atualizar simulação' });
  }
});

router.delete('/simulations/:id', async (req, res) => {
  try {
    const result = await deleteSimulation(req.userId, req.params.id);
    if (result.error) {
      res.status(result.status || 400).json({ message: result.error });
      return;
    }
    res.status(204).send();
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: 'Erro ao excluir simulação' });
  }
});

module.exports = router;
