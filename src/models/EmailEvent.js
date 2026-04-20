const mongoose = require('mongoose');

const emailEventSchema = new mongoose.Schema(
  {
    providerEventId: { type: String, trim: true, required: true, unique: true },
    providerMessageId: { type: String, trim: true, default: null, index: true },
    emailJobId: { type: mongoose.Schema.Types.ObjectId, ref: 'EmailJob', index: true, default: null },
    appId: { type: mongoose.Schema.Types.ObjectId, ref: 'App', index: true, default: null },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true, default: null },
    eventType: {
      type: String,
      enum: ['processed', 'delivered', 'open', 'click', 'bounce', 'dropped', 'spamreport'],
      required: true,
      index: true,
    },
    eventAt: { type: Date, required: true, index: true },
    rawPayload: { type: mongoose.Schema.Types.Mixed, default: {} },
    expireAt: { type: Date, index: { expireAfterSeconds: 0 } },
  },
  { timestamps: true }
);

emailEventSchema.index({ appId: 1, eventAt: -1 });

const EmailEvent = mongoose.model('EmailEvent', emailEventSchema);

module.exports = { EmailEvent };
