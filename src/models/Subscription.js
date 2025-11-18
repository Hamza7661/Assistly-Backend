const mongoose = require('mongoose');

const subscriptionSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  package: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Package',
    required: true
  },
  stripeCustomerId: {
    type: String,
    required: true,
    index: true
  },
  stripeSubscriptionId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  stripePriceId: {
    type: String,
    required: true
  },
  status: {
    type: String,
    enum: ['active', 'canceled', 'past_due', 'unpaid', 'incomplete', 'incomplete_expired', 'trialing', 'paused'],
    default: 'incomplete',
    required: true
  },
  currentPeriodStart: {
    type: Date,
    required: true
  },
  currentPeriodEnd: {
    type: Date,
    required: true
  },
  cancelAtPeriodEnd: {
    type: Boolean,
    default: false
  },
  canceledAt: {
    type: Date,
    default: null
  },
  trialStart: {
    type: Date,
    default: null
  },
  trialEnd: {
    type: Date,
    default: null
  },
  billingCycle: {
    type: String,
    enum: ['monthly', 'yearly', 'one-time'],
    required: true
  },
  amount: {
    type: Number,
    required: true
  },
  currency: {
    type: String,
    default: 'USD',
    required: true
  },
  metadata: {
    type: Map,
    of: String,
    default: {}
  },
  createdAt: {
    type: Date,
    default: Date.now,
    immutable: true
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

subscriptionSchema.index({ user: 1, status: 1 });
subscriptionSchema.index({ stripeCustomerId: 1 });
subscriptionSchema.index({ currentPeriodEnd: 1 });

subscriptionSchema.virtual('isActive').get(function() {
  return this.status === 'active' || this.status === 'trialing';
});

subscriptionSchema.virtual('isExpired').get(function() {
  return this.currentPeriodEnd && this.currentPeriodEnd < new Date();
});

subscriptionSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

const Subscription = mongoose.model('Subscription', subscriptionSchema);

module.exports = { Subscription };

