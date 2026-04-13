const express = require('express');
const mongoose = require('mongoose');
const { AppPlan } = require('../models/AppPlan');
const { App } = require('../models/App');
const { AppError } = require('../utils/errorHandler');
const { verifySignedThirdPartyForParamUser } = require('../middleware/thirdParty');
const { authenticateToken } = require('../middleware/auth');
const { verifyAppOwnership } = require('../middleware/appOwnership');
const { logger } = require('../utils/logger');

const router = express.Router();

const CHANNELS = ['web', 'whatsapp', 'facebook', 'instagram', 'voice'];

function defaultUsagePayload(appId) {
  const channels = {};
  const quotas = {};
  for (const ch of CHANNELS) {
    channels[ch] = { enabled: true };
    quotas[ch] = {
      enabled: false,
      limit: 0,
      used: 0,
      periodStart: null,
      resetAt: null,
      lastResetAt: null,
      remaining: null,
      unlimited: true
    };
  }
  return {
    appId: String(appId),
    channels,
    quotas,
    addons: { smsVerification: false },
    resetCycle: 'monthly',
    paymentCleared: true,
    paymentClearedAt: null,
    nextPaymentDue: null
  };
}

function enrichQuotaForResponse(q) {
  if (!q) {
    return {
      enabled: false,
      limit: 0,
      used: 0,
      periodStart: null,
      resetAt: null,
      lastResetAt: null,
      remaining: null,
      unlimited: true
    };
  }
  const enabled = !!q.enabled;
  const limit = Number(q.limit) || 0;
  const used = Number(q.used) || 0;
  const unlimited = !enabled;
  const remaining = unlimited ? null : Math.max(0, limit - used);
  return {
    enabled,
    limit,
    used,
    periodStart: q.periodStart || null,
    resetAt: q.resetAt || null,
    lastResetAt: q.lastResetAt || null,
    remaining,
    unlimited
  };
}

/** GET usage — JWT + app ownership (dashboard widget). */
router.get('/owner/apps/:appId/usage', authenticateToken, verifyAppOwnership, async (req, res, next) => {
  try {
    const appId = req.appId;
    const plan = await AppPlan.findOne({ appId }).lean();
    if (!plan) {
      return res.status(200).json({ status: 'success', data: defaultUsagePayload(appId) });
    }
    const channels = {};
    const quotas = {};
    for (const ch of CHANNELS) {
      channels[ch] = { enabled: plan.channels?.[ch]?.enabled !== false };
      quotas[ch] = enrichQuotaForResponse(plan.quotas?.[ch]);
    }
    return res.status(200).json({
      status: 'success',
      data: {
        appId: String(plan.appId),
        channels,
        quotas,
        addons: plan.addons || { smsVerification: false },
        resetCycle: plan.resetCycle || 'monthly',
        paymentCleared: !!plan.paymentCleared,
        paymentClearedAt: plan.paymentClearedAt || null,
        nextPaymentDue: plan.nextPaymentDue || null
      }
    });
  } catch (err) {
    next(err);
  }
});

/** GET usage — signed; AI / internal (read-only). */
router.get('/apps/:appId/usage', verifySignedThirdPartyForParamUser, async (req, res, next) => {
  try {
    const { appId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(appId)) {
      return next(new AppError('Invalid app id', 400));
    }
    const plan = await AppPlan.findOne({ appId }).lean();
    if (!plan) {
      return res.status(200).json({ status: 'success', data: defaultUsagePayload(appId) });
    }
    const channels = {};
    const quotas = {};
    for (const ch of CHANNELS) {
      channels[ch] = { enabled: plan.channels?.[ch]?.enabled !== false };
      quotas[ch] = enrichQuotaForResponse(plan.quotas?.[ch]);
    }
    return res.status(200).json({
      status: 'success',
      data: {
        appId: String(plan.appId),
        channels,
        quotas,
        addons: plan.addons || { smsVerification: false },
        resetCycle: plan.resetCycle || 'monthly',
        paymentCleared: !!plan.paymentCleared,
        paymentClearedAt: plan.paymentClearedAt || null,
        nextPaymentDue: plan.nextPaymentDue || null
      }
    });
  } catch (err) {
    next(err);
  }
});

/** Atomic quota consume — signed; AI calls at conversation start. */
router.post(
  '/apps/:appId/quota/:channel/check-and-increment',
  verifySignedThirdPartyForParamUser,
  async (req, res, next) => {
    try {
      const { appId, channel } = req.params;
      if (!mongoose.Types.ObjectId.isValid(appId)) {
        return next(new AppError('Invalid app id', 400));
      }
      if (!CHANNELS.includes(channel)) {
        return next(new AppError('Invalid channel', 400));
      }
      const app = await App.findById(appId).select('_id').lean();
      if (!app) {
        return next(new AppError('App not found', 404));
      }

      let plan = await AppPlan.findOne({ appId });
      if (!plan) {
        return res.status(200).json({
          status: 'success',
          data: { allowed: true, remaining: null, unlimited: true, reason: 'no_plan' }
        });
      }

      if (plan.channels?.[channel]?.enabled === false) {
        return res.status(200).json({
          status: 'success',
          data: { allowed: false, remaining: 0, unlimited: false, reason: 'channel_disabled' }
        });
      }

      const q = plan.quotas?.[channel];
      if (!q || !q.enabled) {
        return res.status(200).json({
          status: 'success',
          data: { allowed: true, remaining: null, unlimited: true, reason: 'quota_disabled' }
        });
      }

      const limit = Number(q.limit) || 0;
      const usedBefore = Number(q.used) || 0;
      if (limit <= 0) {
        return res.status(200).json({
          status: 'success',
          data: { allowed: true, remaining: null, unlimited: true, reason: 'zero_limit_treated_unlimited' }
        });
      }

      const updated = await AppPlan.findOneAndUpdate(
        {
          _id: plan._id,
          [`quotas.${channel}.used`]: { $lt: limit }
        },
        { $inc: { [`quotas.${channel}.used`]: 1 } },
        { new: true }
      );

      if (!updated) {
        return res.status(200).json({
          status: 'success',
          data: {
            allowed: false,
            remaining: 0,
            unlimited: false,
            reason: 'quota_exceeded'
          }
        });
      }

      const usedAfter = Number(updated.quotas[channel].used) || 0;
      return res.status(200).json({
        status: 'success',
        data: {
          allowed: true,
          remaining: Math.max(0, limit - usedAfter),
          unlimited: false,
          used: usedAfter,
          limit
        }
      });
    } catch (err) {
      next(err);
    }
  }
);

/** Force reset all channel used counts — signed; super-admin tooling. */
router.post('/apps/:appId/quota/force-reset', verifySignedThirdPartyForParamUser, async (req, res, next) => {
  try {
    const { appId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(appId)) {
      return next(new AppError('Invalid app id', 400));
    }
    const now = new Date();
    const $set = {};
    for (const ch of CHANNELS) {
      $set[`quotas.${ch}.used`] = 0;
      $set[`quotas.${ch}.lastResetAt`] = now;
    }
    const plan = await AppPlan.findOneAndUpdate({ appId }, { $set }, { new: true });
    if (!plan) {
      return next(new AppError('AppPlan not found', 404));
    }
    logger.info('AppPlan force-reset quotas', { appId });
    return res.status(200).json({ status: 'success', message: 'Quotas reset', data: { appPlan: plan } });
  } catch (err) {
    next(err);
  }
});

/** Single-app cron-style reset hook — signed. */
router.post('/apps/:appId/quota/reset', verifySignedThirdPartyForParamUser, async (req, res, next) => {
  try {
    const { appId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(appId)) {
      return next(new AppError('Invalid app id', 400));
    }
    const now = new Date();
    const plan = await AppPlan.findOne({ appId });
    if (!plan) {
      return next(new AppError('AppPlan not found', 404));
    }
    if (plan.resetCycle === 'never') {
      return res.status(200).json({ status: 'success', message: 'resetCycle is never — skipped', data: {} });
    }
    if (!plan.paymentCleared) {
      return res.status(200).json({ status: 'success', message: 'paymentCleared false — skipped', data: {} });
    }
    const $set = {};
    for (const ch of CHANNELS) {
      const resetAt = plan.quotas?.[ch]?.resetAt;
      if (resetAt && new Date(resetAt) <= now) {
        $set[`quotas.${ch}.used`] = 0;
        $set[`quotas.${ch}.periodStart`] = now;
        $set[`quotas.${ch}.lastResetAt`] = now;
        const nextMonth = new Date(now);
        nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);
        nextMonth.setUTCDate(1);
        nextMonth.setUTCHours(0, 1, 0, 0);
        $set[`quotas.${ch}.resetAt`] = nextMonth;
      }
    }
    if (Object.keys($set).length === 0) {
      return res.status(200).json({ status: 'success', message: 'No channel past resetAt', data: {} });
    }
    const updated = await AppPlan.findOneAndUpdate({ appId }, { $set }, { new: true });
    return res.status(200).json({ status: 'success', message: 'Reset applied', data: { appPlan: updated } });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
