const mongoose = require('mongoose');

const calendarNoShowSchema = new mongoose.Schema(
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
      index: true,
    },
    eventTitle: {
      type: String,
      trim: true,
      default: '',
    },
    clientId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Client',
      default: null,
      index: true,
    },
    phone: {
      type: String,
      trim: true,
      default: '',
    },
    /** pending = marcado; queued = na outbox; sent/skipped/failed = resultado */
    followUpStatus: {
      type: String,
      enum: ['pending', 'queued', 'sent', 'skipped', 'failed'],
      default: 'pending',
      index: true,
    },
    followUpError: {
      type: String,
      default: '',
    },
    markedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true }
);

calendarNoShowSchema.index({ userId: 1, calendarEventId: 1 }, { unique: true });
calendarNoShowSchema.index({ userId: 1, followUpStatus: 1, eventStart: 1 });

module.exports = mongoose.model('CalendarNoShow', calendarNoShowSchema);
