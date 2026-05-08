const mongoose = require('mongoose');

const channelLimitSchema = new mongoose.Schema({
  maxConversations: { type: Number, default: 0, min: 0 },
  unlimited: { type: Boolean, default: false }
}, { _id: false });

const channelUsageSchema = new mongoose.Schema({
  usedConversations: { type: Number, default: 0, min: 0 },
  remainingConversations: { type: Number, default: 0, min: 0 }
}, { _id: false });

const channelAccessSchema = new mongoose.Schema({
  status: {
    type: String,
    enum: ['active', 'limit_reached', 'inactive', 'payment_pending'],
    default: 'inactive'
  },
  reason: { type: String, default: null },
  updatedAt: { type: Date, default: Date.now }
}, { _id: false });

const appSubscriptionStateSchema = new mongoose.Schema({
  appId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'App',
    required: true,
    unique: true,
    index: true
  },
  ownerUserId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  catalogPackageId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Package',
    default: null
  },
  planType: {
    type: String,
    enum: ['standard', 'custom'],
    default: 'standard'
  },
  snapshotVersion: {
    type: Number,
    default: 1,
    min: 1
  },
  paymentCleared: {
    type: Boolean,
    default: false,
    index: true
  },
  billingStatus: {
    type: String,
    enum: ['active', 'past_due', 'unpaid', 'canceled', 'incomplete', 'trialing', 'manual'],
    default: 'incomplete'
  },
  externalProvider: {
    type: String,
    enum: ['stripe', 'manual', 'other'],
    default: 'stripe'
  },
  externalSubscriptionId: {
    type: String,
    default: null,
    index: true
  },
  lastPaymentAt: { type: Date, default: null },
  paymentClearedAt: { type: Date, default: null },
  cycleStartAt: { type: Date, default: null },
  cycleEndAt: { type: Date, default: null },
  nextResetAt: { type: Date, default: null },
  lastResetAt: { type: Date, default: null },
  activatedAt: { type: Date, default: null },
  deactivatedAt: { type: Date, default: null },
  limits: {
    channels: {
      web: { type: channelLimitSchema, default: () => ({}) },
      whatsapp: { type: channelLimitSchema, default: () => ({}) },
      messenger: { type: channelLimitSchema, default: () => ({}) },
      instagram: { type: channelLimitSchema, default: () => ({}) },
      voice: { type: channelLimitSchema, default: () => ({}) }
    }
  },
  usage: {
    channels: {
      web: { type: channelUsageSchema, default: () => ({}) },
      whatsapp: { type: channelUsageSchema, default: () => ({}) },
      messenger: { type: channelUsageSchema, default: () => ({}) },
      instagram: { type: channelUsageSchema, default: () => ({}) },
      voice: { type: channelUsageSchema, default: () => ({}) }
    },
    smsVerificationUsed: { type: Number, default: 0, min: 0 }
  },
  addons: {
    smsVerification: {
      enabled: { type: Boolean, default: false },
      limit: { type: Number, default: 0, min: 0 },
      used: { type: Number, default: 0, min: 0 }
    }
  },
  channelAccess: {
    web: { type: channelAccessSchema, default: () => ({}) },
    whatsapp: { type: channelAccessSchema, default: () => ({}) },
    messenger: { type: channelAccessSchema, default: () => ({}) },
    instagram: { type: channelAccessSchema, default: () => ({}) },
    voice: { type: channelAccessSchema, default: () => ({}) }
  },
  idempotencyKeys: [{
    key: { type: String, required: true },
    channel: { type: String, required: true },
    consumedAt: { type: Date, default: Date.now, required: true }
  }]
}, {
  timestamps: true
});

appSubscriptionStateSchema.index({ ownerUserId: 1, paymentCleared: 1 });
appSubscriptionStateSchema.index({ externalSubscriptionId: 1 }, { sparse: true });
appSubscriptionStateSchema.index({ 'idempotencyKeys.key': 1 });

const AppSubscriptionState = mongoose.model('AppSubscriptionState', appSubscriptionStateSchema);

module.exports = { AppSubscriptionState };

