const mongoose = require('mongoose');

/** Evita processar o mesmo evento Stripe duas vezes (retries). */
const schema = new mongoose.Schema(
  {
    eventId: { type: String, required: true, unique: true, index: true },
  },
  { timestamps: true },
);

module.exports = mongoose.model('ProcessedStripeEvent', schema);
