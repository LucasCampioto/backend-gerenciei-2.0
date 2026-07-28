const mongoose = require('mongoose');

const simulationSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    clientId: { type: mongoose.Schema.Types.ObjectId, ref: 'Client', required: true },
    clientName: { type: String, required: true, trim: true },
    clientPhone: { type: String, default: '' },
    clientEmail: { type: String, default: '' },
    procedure: { type: String, required: true },
    procedureId: { type: String, default: '' },
    date: { type: Date, required: true },
    intensity: { type: Number, default: 0 },
    points: { type: Number, default: null },
    costPerPoint: { type: Number, default: null },
    image: { type: String, default: '' },
    /** UUID do par original/after no R2 (EnhancePair) */
    enhancePairId: { type: String, default: '' },
    activePointIds: { type: [Number], default: [] },
    /** Indica se a simulação resultou em venda real do procedimento. */
    saleCompleted: { type: Boolean, default: false },
    clientConsentAt: { type: Date, default: null },
    clientConsentVersion: { type: String, default: '' },
  },
  { timestamps: true },
);

simulationSchema.index({ userId: 1, date: -1 });
simulationSchema.index({ userId: 1, clientId: 1 });

module.exports = mongoose.model('Simulation', simulationSchema);
