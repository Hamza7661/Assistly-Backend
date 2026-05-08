const express = require('express');
const router = express.Router();
const { authenticateToken, requireSuperAdmin } = require('../middleware/auth');
const { verifyAppOwnership } = require('../middleware/appOwnership');
const { verifySignedThirdPartyForParamUser } = require('../middleware/thirdParty');
const { AppError } = require('../utils/errorHandler');
const { SubscriptionEvent } = require('../models/SubscriptionEvent');
const { App } = require('../models/App');
const { Package } = require('../models/Package');
const { AppSubscriptionStateService } = require('../services/appSubscriptionStateService');

router.get('/apps/:appId/state', authenticateToken, verifyAppOwnership, async (req, res, next) => {
  try {
    const state = await AppSubscriptionStateService.ensureStateForApp(req.params.appId);
    if (!state) return next(new AppError('App not found', 404));
    res.status(200).json({
      status: 'success',
      data: {
        subscriptionState: AppSubscriptionStateService.summarize(state)
      }
    });
  } catch (error) {
    next(error);
  }
});

router.get('/admin/apps/:appId/state', authenticateToken, requireSuperAdmin, async (req, res, next) => {
  try {
    const state = await AppSubscriptionStateService.ensureStateForApp(req.params.appId);
    if (!state) return next(new AppError('App not found', 404));
    res.status(200).json({
      status: 'success',
      data: {
        subscriptionState: AppSubscriptionStateService.summarize(state)
      }
    });
  } catch (error) {
    next(error);
  }
});

router.get('/apps/:appId/report', authenticateToken, verifyAppOwnership, async (req, res, next) => {
  try {
    const state = await AppSubscriptionStateService.ensureStateForApp(req.params.appId);
    if (!state) return next(new AppError('App not found', 404));

    const { from, to, eventType, channel } = req.query;
    const query = { appSubscriptionStateId: state._id };
    if (eventType) query.eventType = eventType;
    if (channel) query.channel = channel;
    if (from || to) {
      query.occurredAt = {};
      if (from) query.occurredAt.$gte = new Date(from);
      if (to) query.occurredAt.$lte = new Date(to);
    }
    const events = await SubscriptionEvent.find(query)
      .sort({ occurredAt: -1 })
      .limit(500)
      .lean();

    res.status(200).json({
      status: 'success',
      data: {
        subscriptionState: AppSubscriptionStateService.summarize(state),
        events
      }
    });
  } catch (error) {
    next(error);
  }
});

router.post('/apps/:appId/payment-clear', authenticateToken, requireSuperAdmin, async (req, res, next) => {
  try {
    const { paymentCleared, billingStatus } = req.body || {};
    if (typeof paymentCleared !== 'boolean') {
      return next(new AppError('paymentCleared boolean is required', 400));
    }
    const state = await AppSubscriptionStateService.markPaymentCleared({
      appId: req.params.appId,
      paymentCleared,
      billingStatus,
      actorType: 'admin',
      actorId: req.user?.id || null,
      metadata: { source: 'manual_app_action' }
    });
    res.status(200).json({
      status: 'success',
      data: { subscriptionState: AppSubscriptionStateService.summarize(state) }
    });
  } catch (error) {
    next(error);
  }
});

router.post('/apps/:appId/reset-cycle', authenticateToken, requireSuperAdmin, async (req, res, next) => {
  try {
    const state = await AppSubscriptionStateService.resetCycle({
      appId: req.params.appId,
      actorType: 'admin',
      actorId: req.user?.id || null,
      metadata: { source: 'manual_app_action' }
    });
    res.status(200).json({
      status: 'success',
      data: { subscriptionState: AppSubscriptionStateService.summarize(state) }
    });
  } catch (error) {
    next(error);
  }
});

router.post('/apps/:appId/entitlement-snapshot', authenticateToken, requireSuperAdmin, async (req, res, next) => {
  try {
    const {
      catalogPackageId = null,
      planType = 'standard',
      channelLimits = {},
      smsVerificationAddon = { enabled: false, limit: 0 }
    } = req.body || {};
    const state = await AppSubscriptionStateService.applyEntitlementSnapshot({
      appId: req.params.appId,
      catalogPackageId,
      planType,
      channelLimits,
      smsVerificationAddon,
      actorType: 'admin',
      actorId: req.user?.id || null,
      metadata: { source: 'manual_snapshot_sync' }
    });
    res.status(200).json({
      status: 'success',
      data: { subscriptionState: AppSubscriptionStateService.summarize(state) }
    });
  } catch (error) {
    next(error);
  }
});

/**
 * Super-admin/admin path:
 * assign a catalog plan to any app and optionally override channel limits/add-ons.
 * This makes the assigned snapshot the live runtime entitlement for that app.
 */
router.post('/admin/apps/:appId/assign-plan', authenticateToken, requireSuperAdmin, async (req, res, next) => {
  try {
    const { appId } = req.params;
    const {
      packageId = null,
      customChannelLimits = {},
      smsVerificationAddon = null,
      paymentCleared = true,
      billingStatus = 'manual'
    } = req.body || {};

    const app = await App.findById(appId).select('_id owner name').lean();
    if (!app) return next(new AppError('App not found', 404));

    let pkg = null;
    if (packageId) {
      pkg = await Package.findById(packageId).lean();
      if (!pkg) return next(new AppError('Package not found', 404));
    }

    const fromPackageChatbotLimit = pkg?.limits?.chatbotQueries === -1
      ? { maxConversations: 0, unlimited: true }
      : { maxConversations: Math.max(0, Number(pkg?.limits?.chatbotQueries || 0)), unlimited: false };
    const baseLimits = {
      web: { ...fromPackageChatbotLimit },
      whatsapp: { ...fromPackageChatbotLimit },
      messenger: { ...fromPackageChatbotLimit },
      instagram: { ...fromPackageChatbotLimit },
      voice: {
        maxConversations: pkg?.limits?.voiceMinutes === -1 ? 0 : Math.max(0, Number(pkg?.limits?.voiceMinutes || 0)),
        unlimited: pkg?.limits?.voiceMinutes === -1
      }
    };

    const mergedLimits = {
      ...baseLimits,
      ...customChannelLimits
    };

    const smsAddonResolved = smsVerificationAddon || {
      enabled: false,
      limit: 0
    };

    await AppSubscriptionStateService.applyEntitlementSnapshot({
      appId: app._id,
      catalogPackageId: pkg?._id || null,
      planType: pkg?.isCustom ? 'custom' : (pkg ? 'standard' : 'custom'),
      channelLimits: mergedLimits,
      smsVerificationAddon: smsAddonResolved,
      actorType: 'admin',
      actorId: req.user?.id || null,
      metadata: {
        source: 'super_admin_assign_plan',
        packageId: pkg?._id || null,
        appName: app.name || null
      }
    });

    await AppSubscriptionStateService.markPaymentCleared({
      appId: app._id,
      paymentCleared: !!paymentCleared,
      billingStatus,
      actorType: 'admin',
      actorId: req.user?.id || null,
      metadata: { source: 'super_admin_assign_plan' }
    });

    await AppSubscriptionStateService.resetCycle({
      appId: app._id,
      actorType: 'admin',
      actorId: req.user?.id || null,
      metadata: { source: 'super_admin_assign_plan' }
    });

    const refreshed = await AppSubscriptionStateService.ensureStateForApp(app._id);

    res.status(200).json({
      status: 'success',
      message: 'Plan assigned to app successfully',
      data: {
        app: {
          id: app._id,
          name: app.name,
          owner: app.owner
        },
        package: pkg ? {
          id: pkg._id,
          name: pkg.name,
          type: pkg.type
        } : null,
        subscriptionState: AppSubscriptionStateService.summarize(refreshed)
      }
    });
  } catch (error) {
    next(error);
  }
});

// Signed endpoint for AI runtime: atomic/idempotent conversation consume.
router.post('/public/apps/:appId/consume-conversation', verifySignedThirdPartyForParamUser, async (req, res, next) => {
  try {
    const { channel, idempotencyKey } = req.body || {};
    const result = await AppSubscriptionStateService.consumeConversation({
      appId: req.params.appId,
      channel,
      idempotencyKey
    });
    const httpStatus = result.ok ? 200 : 409;
    res.status(httpStatus).json({
      status: result.ok ? 'success' : 'error',
      data: result
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;

