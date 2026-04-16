const mongoose = require('mongoose');

const subscriptionEventSchema = new mongoose.Schema({
  appId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'App',
    required: true,
    index: true
  },
  appSubscriptionStateId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AppSubscriptionState',
    required: true,
    index: true
  },
  eventType: {
    type: String,
    required: true,
    enum: [
      'subscription_created',
      'payment_cleared',
      'payment_failed',
      'plan_changed',
      'custom_plan_applied',
      'cycle_reset',
      'limit_reached',
      'limit_released',
      'usage_consumed',
      'addon_enabled',
      'addon_disabled'
    ],
    index: true
  },
  channel: {
    type: String,
    enum: ['web', 'whatsapp', 'messenger', 'instagram', 'voice', null],
    default: null,
    index: true
  },
  actorType: {
    type: String,
    enum: ['system', 'admin', 'webhook', 'ai'],
    default: 'system'
  },
  actorId: {
    type: String,
    default: null
  },
  previousState: {
    type: mongoose.Schema.Types.Mixed,
    default: null
  },
  nextState: {
    type: mongoose.Schema.Types.Mixed,
    default: null
  },
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  occurredAt: {
    type: Date,
    default: Date.now,
    index: true
  }
}, {
  timestamps: true
});

subscriptionEventSchema.index({ appId: 1, occurredAt: -1 });
subscriptionEventSchema.index({ appSubscriptionStateId: 1, occurredAt: -1 });
subscriptionEventSchema.index({ eventType: 1, occurredAt: -1 });

const SubscriptionEvent = mongoose.model('SubscriptionEvent', subscriptionEventSchema);

module.exports = { SubscriptionEvent };

