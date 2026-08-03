const mongoose = require('mongoose');

const whatsAppReminderLogSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    calendarEventId: {
      type: String,
      required: true,
      trim: true,
    },
    eventStart: {
      type: Date,
      default: null,
    },
    clientId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Client',
      default: null,
    },
    phone: {
      type: String,
      trim: true,
      default: '',
    },
    message: {
      type: String,
      default: '',
    },
    status: {
      type: String,
      enum: ['sending', 'sent', 'skipped', 'failed', 'test'],
      required: true,
    },
    error: {
      type: String,
      default: '',
    },
  },
  { timestamps: true }
);

whatsAppReminderLogSchema.index({ userId: 1, calendarEventId: 1 }, { unique: true });

module.exports = mongoose.model('WhatsAppReminderLog', whatsAppReminderLogSchema);
