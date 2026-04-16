const { App } = require('../models/App');
const { User } = require('../models/User');
const { AppSubscriptionState } = require('../models/AppSubscriptionState');
const { SubscriptionEvent } = require('../models/SubscriptionEvent');

const CHANNELS = ['web', 'whatsapp', 'messenger', 'instagram', 'voice'];

function getNow() {
  return new Date();
}

function clampNonNegative(n) {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.floor(n));
}

function getChannelLimit(state, channel) {
  return state?.limits?.channels?.[channel] || { maxConversations: 0, unlimited: false };
}

function getChannelUsage(state, channel) {
  return state?.usage?.channels?.[channel] || { usedConversations: 0, remainingConversations: 0 };
}

class AppSubscriptionStateService {
  static async ensureStateForApp(appId) {
    const app = await App.findById(appId).select('_id owner').lean();
    if (!app) return null;

    let state = await AppSubscriptionState.findOne({ appId: app._id });
    if (state) return state;

    const owner = await User.findById(app.owner).select('_id package').populate('package').lean();
    const pkg = owner?.package || null;

    const defaultLimit = pkg?.limits?.chatbotQueries === -1
      ? { maxConversations: 0, unlimited: true }
      : { maxConversations: clampNonNegative(pkg?.limits?.chatbotQueries || 0), unlimited: false };
    const channels = {};
    const usageChannels = {};
    const accessChannels = {};
    for (const channel of CHANNELS) {
      channels[channel] = { ...defaultLimit };
      usageChannels[channel] = {
        usedConversations: 0,
        remainingConversations: defaultLimit.unlimited ? 0 : defaultLimit.maxConversations
      };
      accessChannels[channel] = { status: 'payment_pending', reason: 'payment_not_cleared', updatedAt: getNow() };
    }

    state = await AppSubscriptionState.create({
      appId: app._id,
      ownerUserId: app.owner,
      catalogPackageId: pkg?._id || null,
      planType: pkg?.isCustom ? 'custom' : 'standard',
      paymentCleared: false,
      billingStatus: 'incomplete',
      limits: { channels },
      usage: { channels: usageChannels, smsVerificationUsed: 0 },
      channelAccess: accessChannels,
      addons: {
        smsVerification: { enabled: false, limit: 0, used: 0 }
      }
    });

    await this.logEvent(state, {
      eventType: 'subscription_created',
      actorType: 'system',
      metadata: { source: 'ensureStateForApp' }
    });

    return state;
  }

  static computeIsActive(state) {
    if (!state) return false;
    const now = getNow();
    const withinCycle = !state.cycleEndAt || state.cycleEndAt >= now;
    const allowedStatus = ['active', 'trialing', 'manual'].includes(state.billingStatus);
    return Boolean(state.paymentCleared && withinCycle && allowedStatus);
  }

  static summarize(state) {
    const isActive = this.computeIsActive(state);
    const channels = {};
    for (const channel of CHANNELS) {
      const limit = getChannelLimit(state, channel);
      const usage = getChannelUsage(state, channel);
      let status = state?.channelAccess?.[channel]?.status || 'inactive';
      if (!isActive) status = 'payment_pending';
      else if (!limit.unlimited && usage.usedConversations >= limit.maxConversations) status = 'limit_reached';
      else status = 'active';

      channels[channel] = {
        status,
        limit: {
          maxConversations: limit.maxConversations,
          unlimited: !!limit.unlimited
        },
        usage: {
          usedConversations: usage.usedConversations,
          remainingConversations: limit.unlimited
            ? null
            : Math.max(0, limit.maxConversations - usage.usedConversations)
        }
      };
    }

    return {
      appId: state.appId,
      catalogPackageId: state.catalogPackageId || null,
      paymentCleared: !!state.paymentCleared,
      billingStatus: state.billingStatus,
      isActive,
      cycleStartAt: state.cycleStartAt,
      cycleEndAt: state.cycleEndAt,
      nextResetAt: state.nextResetAt,
      lastResetAt: state.lastResetAt,
      addons: state.addons || {},
      channels
    };
  }

  static async logEvent(state, { eventType, channel = null, actorType = 'system', actorId = null, previousState = null, nextState = null, metadata = {} }) {
    if (!state?._id) return;
    await SubscriptionEvent.create({
      appId: state.appId,
      appSubscriptionStateId: state._id,
      eventType,
      channel,
      actorType,
      actorId,
      previousState,
      nextState,
      metadata,
      occurredAt: getNow()
    });
  }

  static async consumeConversation({ appId, channel, idempotencyKey }) {
    if (!CHANNELS.includes(channel)) {
      return { ok: false, code: 'invalid_channel', message: 'Unsupported channel' };
    }
    if (!idempotencyKey || typeof idempotencyKey !== 'string') {
      return { ok: false, code: 'idempotency_key_required', message: 'Idempotency key is required' };
    }

    const state = await this.ensureStateForApp(appId);
    if (!state) return { ok: false, code: 'app_not_found', message: 'App not found' };

    const summary = this.summarize(state);
    if (!summary.isActive) {
      return { ok: false, code: 'payment_not_cleared', message: 'Subscription is not active', summary };
    }

    const existing = (state.idempotencyKeys || []).find((entry) => entry.key === idempotencyKey);
    if (existing) {
      return { ok: true, idempotent: true, summary };
    }

    const channelLimit = getChannelLimit(state, channel);
    const channelUsage = getChannelUsage(state, channel);
    if (!channelLimit.unlimited && channelUsage.usedConversations >= channelLimit.maxConversations) {
      const prev = { status: state.channelAccess?.[channel]?.status || null };
      await AppSubscriptionState.updateOne(
        { _id: state._id },
        {
          $set: {
            [`channelAccess.${channel}.status`]: 'limit_reached',
            [`channelAccess.${channel}.reason`]: 'conversation_limit_reached',
            [`channelAccess.${channel}.updatedAt`]: getNow()
          }
        }
      );
      const refreshed = await AppSubscriptionState.findById(state._id);
      await this.logEvent(refreshed, {
        eventType: 'limit_reached',
        channel,
        previousState: prev,
        nextState: { status: 'limit_reached' },
        actorType: 'ai'
      });
      return { ok: false, code: 'limit_reached', message: 'Conversation limit reached', summary: this.summarize(refreshed) };
    }

    const update = {
      $push: { idempotencyKeys: { key: idempotencyKey, channel, consumedAt: getNow() } },
      $inc: { [`usage.channels.${channel}.usedConversations`]: 1 },
      $set: {
        [`channelAccess.${channel}.status`]: 'active',
        [`channelAccess.${channel}.reason`]: null,
        [`channelAccess.${channel}.updatedAt`]: getNow()
      }
    };
    if (!channelLimit.unlimited) {
      update.$inc[`usage.channels.${channel}.remainingConversations`] = -1;
    }

    const updated = await AppSubscriptionState.findOneAndUpdate(
      {
        _id: state._id,
        'idempotencyKeys.key': { $ne: idempotencyKey }
      },
      update,
      { new: true }
    );

    // If race already inserted same idempotency key, treat as success idempotent.
    const finalState = updated || await AppSubscriptionState.findById(state._id);
    const finalSummary = this.summarize(finalState);

    await this.logEvent(finalState, {
      eventType: 'usage_consumed',
      channel,
      actorType: 'ai',
      metadata: { idempotencyKey }
    });

    const finalChannel = finalSummary.channels[channel];
    if (finalChannel.status === 'limit_reached') {
      await this.logEvent(finalState, {
        eventType: 'limit_reached',
        channel,
        actorType: 'ai'
      });
    }

    return { ok: true, idempotent: !updated, summary: finalSummary };
  }

  static async markPaymentCleared({ appId, paymentCleared, billingStatus = 'manual', actorType = 'admin', actorId = null, metadata = {} }) {
    const state = await this.ensureStateForApp(appId);
    if (!state) return null;

    const before = this.summarize(state);
    state.paymentCleared = !!paymentCleared;
    state.billingStatus = billingStatus || state.billingStatus;
    if (paymentCleared) {
      const now = getNow();
      state.paymentClearedAt = now;
      state.lastPaymentAt = now;
      state.activatedAt = state.activatedAt || now;
      state.deactivatedAt = null;
    } else {
      state.deactivatedAt = getNow();
    }
    await state.save();
    const after = this.summarize(state);

    await this.logEvent(state, {
      eventType: paymentCleared ? 'payment_cleared' : 'payment_failed',
      actorType,
      actorId,
      previousState: before,
      nextState: after,
      metadata
    });
    return state;
  }

  static async resetCycle({ appId, actorType = 'admin', actorId = null, metadata = {} }) {
    const state = await this.ensureStateForApp(appId);
    if (!state) return null;

    for (const channel of CHANNELS) {
      const limit = getChannelLimit(state, channel);
      state.usage.channels[channel].usedConversations = 0;
      state.usage.channels[channel].remainingConversations = limit.unlimited ? 0 : limit.maxConversations;
      state.channelAccess[channel].status = this.computeIsActive(state) ? 'active' : 'payment_pending';
      state.channelAccess[channel].reason = null;
      state.channelAccess[channel].updatedAt = getNow();
    }
    state.lastResetAt = getNow();
    state.idempotencyKeys = [];
    await state.save();

    await this.logEvent(state, {
      eventType: 'cycle_reset',
      actorType,
      actorId,
      metadata
    });
    return state;
  }

  static async applyEntitlementSnapshot({
    appId,
    catalogPackageId = null,
    planType = 'standard',
    channelLimits = {},
    smsVerificationAddon = { enabled: false, limit: 0 },
    actorType = 'admin',
    actorId = null,
    metadata = {}
  }) {
    const state = await this.ensureStateForApp(appId);
    if (!state) return null;

    const before = this.summarize(state);
    state.catalogPackageId = catalogPackageId || state.catalogPackageId;
    state.planType = planType === 'custom' ? 'custom' : 'standard';
    state.snapshotVersion = (state.snapshotVersion || 1) + 1;

    for (const channel of CHANNELS) {
      const input = channelLimits[channel] || {};
      const unlimited = !!input.unlimited;
      const max = clampNonNegative(input.maxConversations || 0);
      state.limits.channels[channel].unlimited = unlimited;
      state.limits.channels[channel].maxConversations = max;
      const used = clampNonNegative(state.usage.channels[channel].usedConversations || 0);
      state.usage.channels[channel].remainingConversations = unlimited ? 0 : Math.max(0, max - used);
    }

    state.addons.smsVerification.enabled = !!smsVerificationAddon.enabled;
    state.addons.smsVerification.limit = clampNonNegative(smsVerificationAddon.limit || 0);
    if (state.addons.smsVerification.used > state.addons.smsVerification.limit && state.addons.smsVerification.limit > 0) {
      state.addons.smsVerification.used = state.addons.smsVerification.limit;
    }
    await state.save();

    const after = this.summarize(state);
    await this.logEvent(state, {
      eventType: state.planType === 'custom' ? 'custom_plan_applied' : 'plan_changed',
      actorType,
      actorId,
      previousState: before,
      nextState: after,
      metadata
    });
    return state;
  }
}

module.exports = { AppSubscriptionStateService, CHANNELS };

