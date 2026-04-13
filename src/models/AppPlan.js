const mongoose = require('mongoose');

const quotaChannelPaths = {
  enabled: { type: Boolean, default: false },
  limit: { type: Number, default: 0, min: 0 },
  used: { type: Number, default: 0, min: 0 },
  periodStart: { type: Date, default: null },
  resetAt: { type: Date, default: null },
  lastResetAt: { type: Date, default: null }
};

const appPlanSchema = new mongoose.Schema(
  {
    appId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'App',
      required: true,
      unique: true,
      index: true
    },
    channels: {
      web: { enabled: { type: Boolean, default: true } },
      whatsapp: { enabled: { type: Boolean, default: true } },
      facebook: { enabled: { type: Boolean, default: true } },
      instagram: { enabled: { type: Boolean, default: true } },
      voice: { enabled: { type: Boolean, default: true } }
    },
    quotas: {
      web: quotaChannelPaths,
      whatsapp: quotaChannelPaths,
      facebook: quotaChannelPaths,
      instagram: quotaChannelPaths,
      voice: quotaChannelPaths
    },
    addons: {
      smsVerification: { type: Boolean, default: false }
    },
    resetCycle: {
      type: String,
      enum: ['monthly', 'never'],
      default: 'monthly'
    },
    paymentCleared: { type: Boolean, default: true },
    paymentClearedAt: { type: Date, default: null },
    nextPaymentDue: { type: Date, default: null },
    updatedBy: { type: String, default: null, trim: true },
    updatedAt: { type: Date, default: Date.now }
  },
  { timestamps: true }
);

appPlanSchema.pre('save', function (next) {
  this.updatedAt = new Date();
  next();
});

const AppPlan = mongoose.model('AppPlan', appPlanSchema);

module.exports = { AppPlan };
