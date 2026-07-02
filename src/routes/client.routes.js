const express = require('express');
const router = express.Router();
const {
  getAllClients,
  createClient,
  updateClient,
  deleteClient
} = require('../controllers/client.controller');
const { validate } = require('../middleware/validation.middleware');
const { authenticate } = require('../middleware/auth.middleware');
const { clientSchema } = require('../validators/client.validator');

router.use(authenticate);

router.get('/', getAllClients);
router.post('/', validate(clientSchema), createClient);
router.put('/:id', validate(clientSchema), updateClient);
router.delete('/:id', deleteClient);

module.exports = router;
