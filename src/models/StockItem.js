const mongoose = require('mongoose');

const STOCK_UNITS = ['un', 'ml', 'cx', 'frasco', 'kit', 'g', 'kg', 'l'];

const stockItemSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    quantity: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
    },
    unit: {
      type: String,
      required: true,
      trim: true,
      enum: STOCK_UNITS,
      default: 'un',
    },
    minQuantity: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
    },
    /** Valor total pago pelo produto/lote (não por unidade). */
    totalCost: {
      type: Number,
      min: 0,
      default: null,
    },
    /** Custo por unidade — opcional. */
    unitCost: {
      type: Number,
      min: 0,
      default: null,
    },
    notes: {
      type: String,
      trim: true,
      default: '',
    },
    active: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

stockItemSchema.index({ userId: 1, name: 1 });

module.exports = mongoose.model('StockItem', stockItemSchema);
module.exports.STOCK_UNITS = STOCK_UNITS;
