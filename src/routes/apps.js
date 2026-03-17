const express = require('express');
const router = express.Router();
const { App, appValidationSchema, appUpdateValidationSchema } = require('../models/App');
const { User } = require('../models/User');
const { logger } = require('../utils/logger');
const { AppError } = require('../utils/errorHandler');
const { authenticateToken } = require('../middleware/auth');
const { verifySignedThirdPartyForParamUser } = require('../middleware/thirdParty');
const SeedDataService = require('../services/seedDataService');
const { LEAD_TYPES_LIST } = require('../enums/leadTypes');
const cacheManager = require('../utils/cache');
const { Integration } = require('../models/Integration');
const { Questionnaire, QUESTIONNAIRE_TYPES } = require('../models/Questionnaire');
const { QuestionType } = require('../models/QuestionType');
const { ChatbotWorkflow } = require('../models/ChatbotWorkflow');
const { getTwilioPhoneService } = require('../services/twilioPhoneService');
const { getWhatsAppSenderService } = require('../services/whatsappSenderService');

const FACEBOOK_GRAPH_BASE_URL = process.env.FACEBOOK_GRAPH_BASE_URL;

function getDefaultIntegrationConfig() {
  return {
    assistantName: process.env.DEFAULT_ASSISTANT_NAME || 'Assistant',
    companyName: '',
    greeting: process.env.DEFAULT_GREETING || 'Hi this is {assistantName} your virtual ai assistant from {companyName}. How can I help you today?',
    validateEmail: true,
    validatePhoneNumber: true,
    googleReviewEnabled: false,
    googleReviewUrl: null,
    calendarConnected: false
  };
}

// Slug from label so value matches displayed text (e.g. "Catering" -> "catering")
function slugifyLeadValue(text) {
  if (!text || typeof text !== 'string') return '';
  return text.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '') || '';
}

// Use application-based lead type messages from Integration when present; otherwise fallback to default list
// Normalize value from text on read so all apps/industries get correct routing even if DB had stale value
function getLeadTypesFromIntegration(integration) {
  if (integration?.leadTypeMessages && Array.isArray(integration.leadTypeMessages) && integration.leadTypeMessages.length > 0) {
    const active = integration.leadTypeMessages
      .filter(m => m.isActive !== false)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    return active.map((m, idx) => {
      const text = m.text || '';
      const slug = slugifyLeadValue(text);
      const value = slug || m.value || `custom-${m.id ?? idx + 1}`;
      const out = {
        id: m.id,
        value,
        text,
        ...(Array.isArray(m.relevantServicePlans) && m.relevantServicePlans.length > 0 && { relevantServicePlans: m.relevantServicePlans }),
        ...(Array.isArray(m.synonyms) && m.synonyms.length > 0 && { synonyms: m.synonyms.filter(Boolean).map(s => String(s).trim()).filter(Boolean) })
      };
      if (m.labels && typeof m.labels === 'object') {
        out.labels = m.labels instanceof Map ? Object.fromEntries(m.labels) : m.labels;
      }
      return out;
    });
  }
  return LEAD_TYPES_LIST;
}

class AppController {
  /**
   * Exchange a short-lived Facebook user access token for a long-lived one,
   * then fetch the Page access token for the given pageId.
   * Returns only long-lived tokens + page info (no short-lived token stored).
   */
  static async exchangeAndGetPageToken(shortLivedToken, pageId) {
    const fbAppId = process.env.FACEBOOK_APP_ID;
    const fbAppSecret = process.env.FACEBOOK_APP_SECRET;
    const apiVersion = process.env.FACEBOOK_API_VERSION || 'v22.0';

    if (!fbAppId || !fbAppSecret) {
      throw new AppError('FACEBOOK_APP_ID and FACEBOOK_APP_SECRET must be configured on the server', 500);
    }

    // 1) Exchange short-lived user token -> long-lived (~60 days)
    const exchangeRes = await fetch(
      `${FACEBOOK_GRAPH_BASE_URL}/${apiVersion}/oauth/access_token` +
      `?grant_type=fb_exchange_token` +
      `&client_id=${encodeURIComponent(fbAppId)}` +
      `&client_secret=${encodeURIComponent(fbAppSecret)}` +
      `&fb_exchange_token=${encodeURIComponent(shortLivedToken)}`
    );
    const exchangeData = await exchangeRes.json();
    if (exchangeData.error) {
      throw new AppError(`Facebook token exchange failed: ${exchangeData.error.message}`, 400);
    }

    const longLivedToken = exchangeData.access_token;
    const expiresIn = exchangeData.expires_in || 60 * 24 * 60 * 60; // default ~60 days
    const tokenExpiry = new Date(Date.now() + expiresIn * 1000);

    // 2) Use long-lived user token to fetch managed pages and get page access token
    const accountsRes = await fetch(
      `${FACEBOOK_GRAPH_BASE_URL}/${apiVersion}/me/accounts` +
      `?fields=id,name,access_token` +
      `&access_token=${encodeURIComponent(longLivedToken)}`
    );
    const accountsData = await accountsRes.json();
    if (accountsData.error) {
      throw new AppError(`Failed to retrieve Facebook pages: ${accountsData.error.message}`, 400);
    }

    const page = (accountsData.data || []).find(p => p.id === String(pageId));
    if (!page) {
      throw new AppError('Selected Facebook page not found in your managed pages list', 400);
    }

    return {
      longLivedToken,
      pageAccessToken: page.access_token,
      pageName: page.name,
      tokenExpiry
    };
  }

  /**
   * Fetch Instagram Business Account linked to a Facebook Page.
   * The Page access token works for both Messenger and Instagram when the Page has Instagram linked.
   * Returns { instagramBusinessAccountId, instagramUsername } or null if no Instagram linked.
   */
  static async fetchInstagramBusinessAccount(pageId, pageAccessToken) {
    const apiVersion = process.env.FACEBOOK_API_VERSION || 'v22.0';
    const url =
      `${FACEBOOK_GRAPH_BASE_URL || 'https://graph.facebook.com'}/${apiVersion}/${encodeURIComponent(pageId)}` +
      `?fields=instagram_business_account{id,username}` +
      `&access_token=${encodeURIComponent(pageAccessToken)}`;

    const res = await fetch(url);
    const data = await res.json().catch(() => ({}));

    if (!res.ok || data.error) {
      logger.warn('Could not fetch Instagram Business Account for page', {
        pageId,
        error: data?.error?.message || res.statusText
      });
      return null;
    }

    const igAccount = data.instagram_business_account;
    if (!igAccount || !igAccount.id) {
      return null;
    }

    return {
      instagramBusinessAccountId: String(igAccount.id).trim(),
      instagramUsername: igAccount.username ? String(igAccount.username).trim() : null
    };
  }

  /**
   * Subscribe a Facebook Page to this app's webhook in Meta.
   * This assumes the app-level webhook URL + verify token are already configured
   * in the Meta App Dashboard; here we only associate the Page with the app.
   */
  static async subscribePageWebhook(pageId, pageAccessToken) {
    const apiVersion = process.env.FACEBOOK_API_VERSION || 'v22.0';
    const subscribedFields =
      process.env.FACEBOOK_SUBSCRIBED_FIELDS || 'messages,messaging_postbacks';

    if (!pageId || !pageAccessToken) {
      throw new AppError('Page ID and Page Access Token are required to subscribe webhook', 400);
    }

    const url =
      `https://graph.facebook.com/${apiVersion}/${encodeURIComponent(pageId)}/subscribed_apps` +
      `?subscribed_fields=${encodeURIComponent(subscribedFields)}` +
      `&access_token=${encodeURIComponent(pageAccessToken)}`;

    const res = await fetch(url, { method: 'POST' });
    const data = await res.json().catch(() => ({}));

    if (!res.ok || data.error) {
      const msg = data?.error?.message || res.statusText || 'Unknown error';
      throw new AppError(`Failed to subscribe Facebook page to webhook: ${msg}`, 400);
    }

    return data;
  }

  // Helper to verify app ownership
  static async verifyAppOwnership(appId, userId) {
    // Reject non-ObjectIds so paths like "available-numbers" never hit the DB (avoids Cast to ObjectId error)
    const idStr = String(appId || '');
    if (!/^[a-fA-F0-9]{24}$/.test(idStr)) {
      throw new AppError('App not found', 404);
    }
    // Don't allow access to deleted apps (handle both null and non-existent deletedAt)
    const app = await App.findOne({ 
      _id: appId,
      $or: [
        { deletedAt: null },
        { deletedAt: { $exists: false } }
      ]
    });
    if (!app) {
      throw new AppError('App not found', 404);
    }
    if (app.owner.toString() !== userId.toString()) {
      throw new AppError('You do not have permission to access this app', 403);
    }
    return app;
  }

  async createApp(req, res, next) {
    try {
      const userId = req.user.id;
      const { error, value } = appValidationSchema.validate(req.body, {
        abortEarly: false,
        stripUnknown: true
      });

      if (error) {
        const errorMessages = error.details.map(detail => detail.message);
        throw new AppError(`Validation failed: ${errorMessages.join(', ')}`, 400);
      }

      const {
        name,
        industry,
        description,
        whatsappOption,
        whatsappNumber, twilioPhoneNumber, twilioWhatsAppSenderId, wabaId,
        facebookShortLivedToken,
        facebookPageId,
        facebookPageName
      } = value;

      // Check if app name already exists for this user (only check active apps, exclude deleted)
      const existingApp = await App.findOne({ 
        owner: userId, 
        name: name.trim(), 
        isActive: true,
        $or: [
          { deletedAt: null },
          { deletedAt: { $exists: false } }
        ]
      });
      if (existingApp) {
        throw new AppError('An app with this name already exists', 409);
      }

      const appData = {
        owner: userId,
        name: name.trim(),
        industry,
        description: description || '',
        isActive: true
      };

      // Handle WhatsApp number configuration
      if (whatsappOption === 'use-my-number' && whatsappNumber) {
        const num = whatsappNumber.trim();
        appData.whatsappNumber = num;
        appData.twilioPhoneNumber = num; // same number is used for webhook lookup (required for leads/flows/AI context)
        appData.whatsappNumberSource = 'user-provided';
        appData.whatsappNumberStatus = (twilioWhatsAppSenderId && wabaId) ? 'registered' : 'pending';
        if (twilioWhatsAppSenderId && String(twilioWhatsAppSenderId).trim()) {
          appData.twilioWhatsAppSenderId = String(twilioWhatsAppSenderId).trim();
        }
        if (wabaId != null) appData.wabaId = String(wabaId).trim() || null;
      } else if (whatsappOption === 'get-from-twilio') {
        appData.whatsappNumberSource = 'twilio-provided';
        appData.whatsappNumberStatus = 'pending';
        // Pre-provisioned number (bought only; sender is created by user via Meta signup in Twilio Console)
        if (twilioPhoneNumber) {
          const num = twilioPhoneNumber.trim();
          appData.twilioPhoneNumber = num;
          appData.whatsappNumber = num;
          if (twilioWhatsAppSenderId && String(twilioWhatsAppSenderId).trim()) {
            appData.twilioWhatsAppSenderId = String(twilioWhatsAppSenderId).trim();
          }
          if (wabaId != null) appData.wabaId = String(wabaId).trim() || null;
        }
      }

      const app = new App(appData);
      await app.save();

      // If Facebook OAuth data was provided at creation time, exchange & store long-lived tokens.
      if (facebookShortLivedToken && facebookPageId) {
        try {
          const fbData = await AppController.exchangeAndGetPageToken(facebookShortLivedToken, facebookPageId);
          app.facebookPageId = String(facebookPageId).trim();
          app.facebookPageName = fbData.pageName || facebookPageName || null;
          app.facebookLongLivedToken = fbData.longLivedToken;
          app.facebookPageAccessToken = fbData.pageAccessToken;
          app.facebookTokenExpiry = fbData.tokenExpiry;
          await app.save();

          logger.info('Facebook page connected during app creation', {
            appId: app._id,
            facebookPageId: app.facebookPageId,
            facebookPageName: app.facebookPageName
          });

          // Best-effort: subscribe the page to the Meta webhook configured for this app.
          try {
            const subscriptionResult = await AppController.subscribePageWebhook(
              app.facebookPageId,
              app.facebookPageAccessToken
            );
            logger.info('Facebook page subscribed to webhook during app creation', {
              appId: app._id,
              facebookPageId: app.facebookPageId,
              result: subscriptionResult
            });
          } catch (subErr) {
            // Non-fatal: app is created and tokens are stored; user can re-try subscription later.
            logger.warn('Facebook page webhook subscription failed during app creation', {
              appId: app._id,
              facebookPageId: app.facebookPageId,
              error: subErr.message
            });
          }
        } catch (fbError) {
          // Non-fatal: app creation still succeeds; user can connect later from Edit App.
          logger.warn('Facebook connection failed during app creation', {
            appId: app._id,
            error: fbError.message
          });
        }
      }

      // If this app has a number and is the only one with this number for this owner, it should use the Twilio number
      const num = app.whatsappNumber?.trim?.();
      if (num) {
        const othersWithSameNumber = await App.countDocuments({
          owner: userId,
          _id: { $ne: app._id },
          isActive: true,
          $and: [
            { $or: [ { deletedAt: null }, { deletedAt: { $exists: false } } ] },
            { $or: [ { whatsappNumber: num }, { twilioPhoneNumber: num } ] }
          ]
        });
        if (othersWithSameNumber === 0) {
          app.usesTwilioNumber = true;
          await app.save();
        }
      }

      // Pre-provisioned get-from-twilio: if we don't have sender SID yet, try to find it (user may have completed Meta signup in Twilio Console)
      if (whatsappOption === 'get-from-twilio' && num && !app.twilioWhatsAppSenderId) {
        try {
          const senderService = getWhatsAppSenderService();
          const senderSid = await senderService.findSenderSidByPhoneNumber(num);
          if (senderSid) {
            app.twilioWhatsAppSenderId = senderSid;
            await app.save();
            logger.info(`Linked Twilio sender to app ${app._id}`, { phoneNumber: num, senderSid });
          }
        } catch (linkErr) {
          logger.warn('Could not link Twilio sender to app (user may not have completed Meta signup yet)', { appId: app._id, error: linkErr?.message });
        }
      }

      logger.info(`New app created: ${app.name} (${app._id}) by user ${userId}`);

      // Copy industry-based seed data to the new app (with progress updates via WebSocket)
      try {
        const seedResults = await SeedDataService.copySeedDataToApp(app._id, industry, userId);
        logger.info(`Seed data copied to app ${app._id}:`, seedResults);
      } catch (seedError) {
        // Log error but don't fail app creation if seed data copy fails
        logger.error(`Failed to copy seed data to app ${app._id}:`, seedError);
      }

      res.status(201).json({
        status: 'success',
        message: 'App created successfully',
        data: {
          app: {
            id: app._id,
            name: app.name,
            industry: app.industry,
            description: app.description,
            whatsappNumber: app.whatsappNumber,
            whatsappNumberSource: app.whatsappNumberSource,
            whatsappNumberStatus: app.whatsappNumberStatus,
            facebookPageId: app.facebookPageId,
            facebookPageName: app.facebookPageName,
            facebookTokenExpiry: app.facebookTokenExpiry,
            usesTwilioNumber: !!app.usesTwilioNumber,
            isActive: app.isActive,
            createdAt: app.createdAt,
            updatedAt: app.updatedAt
          }
        }
      });

    } catch (error) {
      if (error.name === 'MongoServerError' && error.code === 11000) {
        return next(new AppError('An app with this name already exists', 409));
      }
      next(error);
    }
  }

  async getApps(req, res, next) {
    try {
      const userId = req.user.id;
      const { includeInactive } = req.query;

      // When includeInactive is true: show all apps (active, inactive, and deleted)
      // Otherwise: only non-deleted apps, and only active ones
      const query = { owner: userId };

      if (includeInactive !== 'true') {
        query.isActive = true;
        query.$or = [
          { deletedAt: null },
          { deletedAt: { $exists: false } }
        ];
      }

      const apps = await App.find(query)
        .sort({ createdAt: -1 })
        .select('-__v');

      res.status(200).json({
        status: 'success',
        data: {
          apps: apps.map(app => ({
            id: app._id,
            name: app.name,
            industry: app.industry,
            description: app.description,
            whatsappNumber: app.whatsappNumber,
            whatsappNumberSource: app.whatsappNumberSource,
            whatsappNumberStatus: app.whatsappNumberStatus,
            usesTwilioNumber: !!app.usesTwilioNumber,
            isActive: app.isActive,
            deletedAt: app.deletedAt || null,
            createdAt: app.createdAt,
            updatedAt: app.updatedAt
          }))
        }
      });

    } catch (error) {
      next(new AppError('Failed to retrieve apps', 500));
    }
  }

  async getApp(req, res, next) {
    try {
      const userId = req.user.id;
      const { id } = req.params;

      const app = await AppController.verifyAppOwnership(id, userId);

      res.status(200).json({
        status: 'success',
        data: {
          app: {
            id: app._id,
            name: app.name,
            industry: app.industry,
            description: app.description,
            whatsappNumber: app.whatsappNumber,
            whatsappNumberSource: app.whatsappNumberSource,
            whatsappNumberStatus: app.whatsappNumberStatus,
            twilioWhatsAppSenderId: app.twilioWhatsAppSenderId,
            wabaId: app.wabaId || null,
            usesTwilioNumber: !!app.usesTwilioNumber,
            facebookPageId: app.facebookPageId,
            facebookPageName: app.facebookPageName,
            facebookTokenExpiry: app.facebookTokenExpiry,
            instagramBusinessAccountId: app.instagramBusinessAccountId,
            instagramUsername: app.instagramUsername,
            isActive: app.isActive,
            createdAt: app.createdAt,
            updatedAt: app.updatedAt
          }
        }
      });

    } catch (error) {
      next(error);
    }
  }

  async updateApp(req, res, next) {
    try {
      const userId = req.user.id;
      const { id } = req.params;

      const { error, value } = appUpdateValidationSchema.validate(req.body, {
        abortEarly: false,
        stripUnknown: true
      });

      if (error) {
        const errorMessages = error.details.map(detail => detail.message);
        throw new AppError(`Validation failed: ${errorMessages.join(', ')}`, 400);
      }

      const app = await AppController.verifyAppOwnership(id, userId);

      // Check if name is being changed and if it conflicts (only check active apps, exclude deleted)
      if (value.name && value.name.trim() !== app.name) {
        const existingApp = await App.findOne({ 
          owner: userId, 
          name: value.name.trim(),
          isActive: true,
          $or: [
            { deletedAt: null },
            { deletedAt: { $exists: false } }
          ],
          _id: { $ne: id }
        });
        if (existingApp) {
          throw new AppError('An app with this name already exists', 409);
        }
        value.name = value.name.trim();
      }

      // Update app
      Object.keys(value).forEach(key => {
        app[key] = value[key];
      });

      // So webhook/AI context lookup finds this app: keep twilioPhoneNumber in sync with whatsappNumber when the app has a number
      if (app.whatsappNumber && typeof app.whatsappNumber === 'string') {
        const num = app.whatsappNumber.trim();
        if (num && !app.twilioPhoneNumber) {
          app.twilioPhoneNumber = num;
        }
      }

      await app.save();

      logger.info(`App updated: ${app.name} (${app._id}) by user ${userId}`);

      res.status(200).json({
        status: 'success',
        message: 'App updated successfully',
        data: {
          app: {
            id: app._id,
            name: app.name,
            industry: app.industry,
            description: app.description,
            whatsappNumber: app.whatsappNumber,
            whatsappNumberSource: app.whatsappNumberSource,
            whatsappNumberStatus: app.whatsappNumberStatus,
            twilioWhatsAppSenderId: app.twilioWhatsAppSenderId,
            usesTwilioNumber: !!app.usesTwilioNumber,
            facebookPageId: app.facebookPageId,
            facebookPageName: app.facebookPageName,
            facebookTokenExpiry: app.facebookTokenExpiry,
            instagramBusinessAccountId: app.instagramBusinessAccountId,
            instagramUsername: app.instagramUsername,
            isActive: app.isActive,
            createdAt: app.createdAt,
            updatedAt: app.updatedAt
          }
        }
      });

    } catch (error) {
      if (error.name === 'MongoServerError' && error.code === 11000) {
        return next(new AppError('An app with this name already exists', 409));
      }
      next(error);
    }
  }

  async deleteApp(req, res, next) {
    try {
      const userId = req.user.id;
      const { id } = req.params;

      const app = await AppController.verifyAppOwnership(id, userId);

      // Soft delete by setting isActive to false and deletedAt timestamp
      const num = (app.twilioPhoneNumber || app.whatsappNumber)?.trim?.();
      app.isActive = false;
      app.deletedAt = new Date();
      await app.save();

      // If the deleted app had a number and used it, assign usesTwilioNumber to one remaining app with the same number (deterministic: oldest by createdAt)
      if (num && app.usesTwilioNumber) {
        const otherWithSameNumber = await App.findOne({
          owner: userId,
          _id: { $ne: id },
          isActive: true,
          $and: [
            { $or: [ { deletedAt: null }, { deletedAt: { $exists: false } } ] },
            { $or: [ { whatsappNumber: num }, { twilioPhoneNumber: num } ] }
          ]
        })
          .sort({ createdAt: 1 }); // among multiple apps with this number, pick the oldest (first created)
        if (otherWithSameNumber) {
          otherWithSameNumber.usesTwilioNumber = true;
          await otherWithSameNumber.save();
          await App.updateMany(
            {
              owner: userId,
              _id: { $nin: [id, otherWithSameNumber._id] },
              $or: [ { whatsappNumber: num }, { twilioPhoneNumber: num } ]
            },
            { $set: { usesTwilioNumber: false } }
          );
          logger.info(`App ${otherWithSameNumber.name} (${otherWithSameNumber._id}) set as usesTwilioNumber after delete of ${app.name}`);
        }
      }

      logger.info(`App deleted (soft): ${app.name} (${app._id}) by user ${userId}`);

      res.status(200).json({
        status: 'success',
        message: 'App deleted successfully'
      });

    } catch (error) {
      next(error);
    }
  }

  async restoreApp(req, res, next) {
    try {
      const userId = req.user.id;
      const { id } = req.params;

      const app = await App.findOne({ _id: id, owner: userId });
      if (!app) {
        throw new AppError('App not found', 404);
      }
      if (!app.deletedAt) {
        throw new AppError('App is not deleted', 400);
      }

      const existingActiveWithSameName = await App.findOne({
        owner: userId,
        _id: { $ne: id },
        name: app.name.trim(),
        isActive: true,
        $or: [
          { deletedAt: null },
          { deletedAt: { $exists: false } }
        ]
      });
      if (existingActiveWithSameName) {
        throw new AppError(`An active app named "${app.name}" already exists. Rename or disable that app first, then try restoring again.`, 409);
      }

      app.deletedAt = null;
      app.isActive = true;
      await app.save();

      logger.info(`App restored: ${app.name} (${app._id}) by user ${userId}`);

      res.status(200).json({
        status: 'success',
        message: 'App restored successfully',
        data: { app: app }
      });
    } catch (error) {
      if (error.code === 11000 && error.keyPattern?.owner && error.keyPattern?.name) {
        next(new AppError('An active app with this name already exists. Rename or disable that app first, then try restoring again.', 409));
        return;
      }
      next(error);
    }
  }

  async registerWhatsApp(req, res, next) {
    try {
      const userId = req.user.id;
      const { id } = req.params;

      const app = await AppController.verifyAppOwnership(id, userId);

      if (!app.whatsappNumber) {
        throw new AppError('WhatsApp number is not configured for this app', 400);
      }

      const senderService = getWhatsAppSenderService();
      const apiPrefix = process.env.API_PREFIX || '/api';
      const apiVersion = process.env.API_VERSION || 'v1';
      const backendUrl = (process.env.BACKEND_URL || process.env.API_BASE_URL || '').replace(/\/$/, '');
      const statusCallbackUrl = backendUrl ? `${backendUrl}${apiPrefix}/${apiVersion}/apps/whatsapp/sender-status` : null;
      const wabaId = app.wabaId || process.env.TWILIO_WABA_ID || null;

      const sender = await senderService.createSender(app.whatsappNumber, {
        wabaId,
        statusCallbackUrl,
        profileName: app.name,
        verificationMethod: 'sms'
      });

      app.twilioWhatsAppSenderId = sender.sid;
      app.whatsappNumberStatus = 'pending';
      await app.save();

      logger.info(`WhatsApp registration triggered for app: ${app.name} (${app._id})`);

      res.status(200).json({
        status: 'success',
        message: 'WhatsApp registration initiated',
        data: {
          app: {
            id: app._id,
            whatsappNumberStatus: app.whatsappNumberStatus
          }
        }
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * After user completes Meta Embedded Signup (Business, WABA) in-app, register the WhatsApp sender
   * with the provisioned phone number and WABA ID. Body: { phoneNumber, wabaId }.
   * For Twilio SMS numbers, verification is handled automatically by Twilio.
   */
  async registerSenderAfterMeta(req, res, next) {
    try {
      const userId = req.user.id;
      const { phoneNumber, wabaId } = req.body || {};

      const num = (phoneNumber || '').trim();
      if (!num || !num.startsWith('+')) {
        throw new AppError('Valid phoneNumber (E.164) is required', 400);
      }
      const waba = (wabaId != null && String(wabaId).trim()) ? String(wabaId).trim() : null;
      if (!waba) {
        throw new AppError('wabaId from Meta Embedded Signup is required', 400);
      }

      const senderService = getWhatsAppSenderService();
      const apiPrefix = process.env.API_PREFIX || '/api';
      const apiVersion = process.env.API_VERSION || 'v1';
      const backendUrl = (process.env.BACKEND_URL || process.env.API_BASE_URL || '').replace(/\/$/, '');
      const statusCallbackUrl = backendUrl ? `${backendUrl}${apiPrefix}/${apiVersion}/apps/whatsapp/sender-status` : null;

      const sender = await senderService.createSender(num, {
        wabaId: waba,
        statusCallbackUrl,
        profileName: 'Business',
        verificationMethod: 'sms'
      });

      logger.info('Sender registered after Meta signup', { userId, phoneNumber: num, senderSid: sender.sid });

      res.status(200).json({
        status: 'success',
        message: 'WhatsApp sender registered',
        data: {
          senderSid: sender.sid,
          phoneNumber: num
        }
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * List available phone numbers for a country (SMS+voice). Query: countryCode (e.g. US, GB). Optional: limit (default 20).
   */
  async getAvailableNumbers(req, res, next) {
    try {
      const userId = req.user.id;
      const { countryCode, limit } = req.query || {};

      const code = (countryCode || '').trim().toUpperCase();
      if (!code || code.length !== 2) {
        throw new AppError('Valid countryCode (ISO 3166-1 alpha-2, e.g. US, GB) is required', 400);
      }

      const phoneService = getTwilioPhoneService();
      const maxLimit = Math.min(parseInt(limit, 10) || 20, 50);
      const numbers = await phoneService.getAvailableNumbers(code, { limit: maxLimit });

      res.status(200).json({
        status: 'success',
        data: {
          countryCode: code,
          numbers: numbers.map((n) => ({ phoneNumber: n.phoneNumber, friendlyName: n.friendlyName || n.phoneNumber }))
        }
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Provision (buy) a number only. Body: { countryCode } or { countryCode, phoneNumber }.
   * If phoneNumber is provided, purchases that number; otherwise buys the first available for the country.
   */
  async provisionNumber(req, res, next) {
    try {
      const userId = req.user.id;
      const { countryCode, phoneNumber: requestedNumber } = req.body || {};

      const code = (countryCode || '').trim().toUpperCase();
      if (!code || code.length !== 2) {
        throw new AppError('Valid countryCode (ISO 3166-1 alpha-2, e.g. US, GB) is required', 400);
      }

      const phoneService = getTwilioPhoneService();
      let result;
      if (requestedNumber && String(requestedNumber).trim().startsWith('+')) {
        result = await phoneService.purchaseNumber(String(requestedNumber).trim());
      } else {
        result = await phoneService.assignFirstAvailableNumber(code);
      }
      if (!result) {
        throw new AppError(`No available numbers for country ${code}`, 404);
      }

      const { phoneNumber } = result;
      logger.info('Number provisioned (buy only, no sender)', { userId, phoneNumber });

      res.status(200).json({
        status: 'success',
        message: 'Number purchased. Complete Meta WhatsApp signup in the wizard below, then create your app.',
        data: {
          phoneNumber
        }
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Assign first available Twilio number for country, then register as WhatsApp sender.
   * Body: { countryCode } (e.g. "US", "GB"). Optionally { wabaId }.
   */
  async assignNumber(req, res, next) {
    try {
      const userId = req.user.id;
      const { id } = req.params;
      const { countryCode, wabaId } = req.body || {};

      const app = await AppController.verifyAppOwnership(id, userId);

      const code = (countryCode || '').trim().toUpperCase();
      if (!code || code.length !== 2) {
        throw new AppError('Valid countryCode (ISO 3166-1 alpha-2, e.g. US, GB) is required', 400);
      }

      const phoneService = getTwilioPhoneService();
      const result = await phoneService.assignFirstAvailableNumber(code);
      if (!result) {
        throw new AppError(`No available numbers for country ${code}`, 404);
      }

      const { phoneNumber } = result;
      app.twilioPhoneNumber = phoneNumber;
      app.whatsappNumber = phoneNumber;
      app.whatsappNumberSource = 'twilio-provided';
      app.whatsappNumberStatus = 'pending';
      if (wabaId != null) app.wabaId = String(wabaId).trim() || null;
      await app.save();

      const senderService = getWhatsAppSenderService();
      const apiPrefix = process.env.API_PREFIX || '/api';
      const apiVersion = process.env.API_VERSION || 'v1';
      const backendUrl = (process.env.BACKEND_URL || process.env.API_BASE_URL || '').replace(/\/$/, '');
      const statusCallbackUrl = backendUrl ? `${backendUrl}${apiPrefix}/${apiVersion}/apps/whatsapp/sender-status` : null;
      const resolvedWabaId = app.wabaId || process.env.TWILIO_WABA_ID || null;

      const sender = await senderService.createSender(phoneNumber, {
        wabaId: resolvedWabaId,
        statusCallbackUrl,
        profileName: app.name,
        verificationMethod: 'sms'
      });

      app.twilioWhatsAppSenderId = sender.sid;
      await app.save();

      const othersWithSameNumber = await App.countDocuments({
        owner: userId,
        _id: { $ne: app._id },
        isActive: true,
        $or: [ { whatsappNumber: phoneNumber }, { twilioPhoneNumber: phoneNumber } ]
      });
      if (othersWithSameNumber === 0) {
        app.usesTwilioNumber = true;
        await app.save();
      }

      logger.info('Twilio number assigned and sender created', { appId: app._id, phoneNumber, senderSid: sender.sid });

      res.status(200).json({
        status: 'success',
        message: 'Number assigned and WhatsApp sender created',
        data: {
          app: {
            id: app._id,
            twilioPhoneNumber: app.twilioPhoneNumber,
            whatsappNumber: app.whatsappNumber,
            whatsappNumberSource: app.whatsappNumberSource,
            whatsappNumberStatus: app.whatsappNumberStatus,
            twilioWhatsAppSenderId: app.twilioWhatsAppSenderId
          }
        }
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Submit verification code for WhatsApp sender (user-provided numbers). Poll or refetch app for status.
   */
  async verifyWhatsApp(req, res, next) {
    try {
      const userId = req.user.id;
      const { id } = req.params;
      const { verificationCode } = req.body || {};

      const app = await AppController.verifyAppOwnership(id, userId);

      if (!app.twilioWhatsAppSenderId) {
        throw new AppError('No WhatsApp sender to verify. Assign or register a number first.', 400);
      }

      const code = (verificationCode || '').trim();
      if (!code) {
        throw new AppError('verificationCode is required', 400);
      }

      const senderService = getWhatsAppSenderService();
      await senderService.submitVerificationCode(app.twilioWhatsAppSenderId, code);

      const updated = await senderService.getSender(app.twilioWhatsAppSenderId);
      const status = (updated.status || '').toUpperCase();
      const isOnline = status === 'ONLINE';
      const isFailed = status === 'OFFLINE' || status === 'FAILED' || (status && status.includes('FAILED'));
      app.whatsappNumberStatus = isOnline ? 'registered' : (isFailed ? 'failed' : 'pending');
      await app.save();

      res.status(200).json({
        status: 'success',
        message: isOnline ? 'WhatsApp number verified' : 'Verification submitted; status may update shortly',
        data: {
          app: {
            id: app._id,
            whatsappNumberStatus: app.whatsappNumberStatus,
            senderStatus: updated.status
          }
        }
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Twilio sender status callback (webhook). Twilio POSTs here when sender status changes.
   * Body may include SenderSid, Status, etc. Find app by twilioWhatsAppSenderId and update whatsappNumberStatus.
   */
  async whatsappSenderStatusCallback(req, res, next) {
    try {
      const { SenderSid, Status } = req.body || {};
      const sid = (SenderSid || '').trim();
      if (!sid) {
        res.status(400).send('SenderSid required');
        return;
      }

      const app = await App.findOne({ twilioWhatsAppSenderId: sid }).exec();
      if (!app) {
        logger.warn('WhatsApp sender status callback: no app found for sender', { sid });
        res.status(200).send('OK');
        return;
      }

      const status = (Status || '').toUpperCase();
      if (status === 'ONLINE') {
        app.whatsappNumberStatus = 'registered';
      } else if (status === 'OFFLINE' || status === 'FAILED' || status.includes('FAILED')) {
        app.whatsappNumberStatus = 'failed';
      }
      await app.save();
      logger.info('WhatsApp sender status updated from webhook', { appId: app._id, sid, status, whatsappNumberStatus: app.whatsappNumberStatus });

      res.status(200).send('OK');
    } catch (error) {
      next(error);
    }
  }

  async getAppContextByTwilioNumber(req, res, next) {
    try {
      const { twilioPhoneNumber } = req.params;
      
      if (!twilioPhoneNumber) {
        return next(new AppError('Twilio phone number is required', 400));
      }

      // Find the app by Twilio phone number (uses usesTwilioNumber when multiple apps share the number)
      const app = await App.findByTwilioPhone(twilioPhoneNumber)
        .populate('owner', 'firstName lastName professionDescription website')
        .select('_id name industry owner')
        .exec();

      if (app) {
        logger.info('App resolved by Twilio number', { twilioPhoneNumber, appId: app._id, appName: app.name });
      }

      if (!app || !app.owner) {
        logger.warn('No app found with Twilio phone number', { 
          twilioPhoneNumber,
          suggestion: 'Run migration: node src/scripts/autoMigrateTwilioToApp.js'
        });
        return next(new AppError('No app found with this Twilio phone number', 404));
      }

      const user = app.owner;
      const appId = app._id;

      // Check cache first
      const cacheKey = cacheManager.getAppContextKey(appId);
      const cachedData = await cacheManager.get(cacheKey);
      
      if (cachedData) {
        logger.info('App context served from cache (by Twilio number)', { twilioPhoneNumber, appId });
        return res.status(200).json(cachedData);
      }

      // Fetch app-specific data (app-wise flow, no user fallback)
      const userApp = { _id: app._id, name: app.name, industry: app.industry };
      
      const treatmentPromise = Questionnaire.find({ owner: appId, type: QUESTIONNAIRE_TYPES.SERVICE_PLAN, isActive: true })
        .select('question answer attachedWorkflows')
        .populate('attachedWorkflows.workflowId', 'title question questionTypeId isRoot order')
        .sort({ updatedAt: -1 })
        .exec();

      const faqPromise = Questionnaire.find({ owner: appId, type: QUESTIONNAIRE_TYPES.FAQ, isActive: true })
        .select('question answer')
        .sort({ updatedAt: -1 })
        .exec();

      // App-wise: Only look for Integration by appId (no user fallback)
      const integrationPromise = Integration.findOne({ owner: appId }).exec();

      const workflowPromise = ChatbotWorkflow.find({ owner: appId })
        .select('title question questionTypeId options attachment.hasFile attachment.filename attachment.contentType isRoot order workflowGroupId isActive')
        .sort({ order: 1, createdAt: 1 })
        .exec();

      const [treatmentDocs, faqDocs, integration, workflowDocs] = await Promise.all([
        treatmentPromise, 
        faqPromise, 
        integrationPromise, 
        workflowPromise
      ]);

      // Get default question type
      const defaultQuestionType = await QuestionType.findOne({ isActive: true })
        .sort({ id: 1 })
        .select('id')
        .lean();
      const defaultQuestionTypeId = defaultQuestionType?.id || 1;

      // Process treatment plans
      const treatmentPlans = treatmentDocs.map(d => ({
        question: d.question,
        answer: d.answer,
        attachedWorkflows: (d.attachedWorkflows || [])
          .filter(aw => aw.workflowId)
          .sort((a, b) => (a.order || 0) - (b.order || 0))
          .map(aw => ({
            workflowId: aw.workflowId._id || aw.workflowId,
            order: aw.order || 0,
            workflow: aw.workflowId ? {
              _id: aw.workflowId._id,
              title: aw.workflowId.title,
              question: aw.workflowId.question,
              questionTypeId: aw.workflowId.questionTypeId,
              isRoot: aw.workflowId.isRoot,
              order: aw.workflowId.order
            } : null
          }))
      }));

      const faq = faqDocs.map(d => ({ question: d.question, answer: d.answer }));

      // Process workflows (same logic as in user.js)
      const workflowMap = {};
      const rootWorkflows = [];
      
      workflowDocs.forEach(w => {
        const workflowData = {
          _id: w._id,
          title: w.title,
          question: w.question,
          questionTypeId: w.questionTypeId,
          options: w.options || [],
          attachment: w.attachment ? {
            hasFile: !!w.attachment.hasFile,
            filename: w.attachment.filename || null,
            contentType: w.attachment.contentType || null
          } : { hasFile: false },
          isRoot: w.isRoot,
          order: w.order,
          workflowGroupId: w.workflowGroupId,
          isActive: w.isActive
        };
        
        if (w.isRoot || !w.workflowGroupId) {
          const groupId = w._id.toString();
          workflowMap[groupId] = {
            ...workflowData,
            questions: []
          };
          rootWorkflows.push(workflowMap[groupId]);
        } else {
          const groupId = w.workflowGroupId ? w.workflowGroupId.toString() : w._id.toString();
          if (!workflowMap[groupId]) {
            const rootWorkflow = workflowDocs.find(rw => 
              (rw._id.toString() === groupId && rw.isRoot) || 
              (rw.workflowGroupId && rw.workflowGroupId.toString() === groupId && rw.isRoot)
            );
            if (rootWorkflow) {
              workflowMap[groupId] = {
                _id: rootWorkflow._id,
                title: rootWorkflow.title,
                question: rootWorkflow.question,
                questionTypeId: rootWorkflow.questionTypeId,
                options: rootWorkflow.options || [],
                attachment: rootWorkflow.attachment ? {
                  hasFile: !!rootWorkflow.attachment.hasFile,
                  filename: rootWorkflow.attachment.filename || null,
                  contentType: rootWorkflow.attachment.contentType || null
                } : { hasFile: false },
                isRoot: rootWorkflow.isRoot,
                order: rootWorkflow.order,
                workflowGroupId: rootWorkflow.workflowGroupId,
                isActive: rootWorkflow.isActive,
                questions: []
              };
              rootWorkflows.push(workflowMap[groupId]);
            } else {
              workflowMap[groupId] = {
                _id: groupId,
                title: 'Unnamed Workflow',
                question: '',
                questionTypeId: defaultQuestionTypeId,
                isRoot: true,
                order: 0,
                isActive: true,
                questions: []
              };
            }
          }
          workflowMap[groupId].questions.push(workflowData);
        }
      });
      
      rootWorkflows.forEach(workflow => {
        if (workflow.questions) {
          workflow.questions = workflow.questions
            .filter(q => q.isActive !== false)
            .sort((a, b) => (a.order || 0) - (b.order || 0));
        }
        if (workflow.isActive === false) {
          const index = rootWorkflows.indexOf(workflow);
          if (index > -1) {
            rootWorkflows.splice(index, 1);
          }
        }
      });
      
      treatmentPlans.forEach(plan => {
        if (plan.attachedWorkflows && Array.isArray(plan.attachedWorkflows)) {
          plan.attachedWorkflows.forEach(attachedFlow => {
            if (attachedFlow.workflow && attachedFlow.workflow._id) {
              const existingIndex = rootWorkflows.findIndex(w => 
                w._id && w._id.toString() === attachedFlow.workflow._id.toString()
              );
              
              if (existingIndex === -1) {
                const workflowToAdd = {
                  ...attachedFlow.workflow,
                  treatmentPlanOrder: attachedFlow.order || 0,
                  treatmentPlanId: plan.question,
                  questions: attachedFlow.workflow.questions || []
                };
                rootWorkflows.push(workflowToAdd);
              } else {
                rootWorkflows[existingIndex].treatmentPlanOrder = attachedFlow.order || 0;
                rootWorkflows[existingIndex].treatmentPlanId = plan.question;
              }
            }
          });
        }
      });
      
      rootWorkflows.sort((a, b) => {
        const aOrder = a.treatmentPlanOrder !== undefined ? a.treatmentPlanOrder : (a.order || 0);
        const bOrder = b.treatmentPlanOrder !== undefined ? b.treatmentPlanOrder : (b.order || 0);
        if (aOrder !== bOrder) {
          return aOrder - bOrder;
        }
        return (a.order || 0) - (b.order || 0);
      });
      
      const workflows = rootWorkflows;

      // Prepare integration data
      const integrationData = integration ? {
        assistantName: integration.assistantName,
        companyName: integration.companyName || '',
        greeting: integration.greeting,
        validateEmail: integration.validateEmail,
        validatePhoneNumber: integration.validatePhoneNumber,
        googleReviewEnabled: !!integration.googleReviewEnabled,
        googleReviewUrl: integration.googleReviewUrl || null,
        calendarConnected: !!integration.googleCalendarConnected,
        calendarSlotMinutes: integration.calendarSlotMinutes ?? 30,
        leadTypeMessages: integration.leadTypeMessages || []
      } : {
        ...getDefaultIntegrationConfig(),
        leadTypeMessages: []
      };

      const responseData = {
        status: 'success',
        data: {
          user: {
            id: user._id,
            firstName: user.firstName,
            lastName: user.lastName,
            professionDescription: user.professionDescription,
            website: user.website
          },
          app: userApp ? { id: userApp._id, name: userApp.name, industry: userApp.industry } : null,
          leadTypes: getLeadTypesFromIntegration(integration),
          treatmentPlans,
          faq,
          integration: integrationData,
          workflows,
          country: process.env.COUNTRY
        }
      };

      // Cache the response for 5 minutes
      await cacheManager.set(cacheKey, responseData, 300);

      logger.info('App context retrieved by Twilio phone number (app-wise)', { 
        twilioPhoneNumber, 
        appId, 
        appName: app.name,
        industry: app.industry 
      });

      res.status(200).json(responseData);
    } catch (error) {
      logger.error('Error retrieving app context by Twilio number', {
        twilioPhoneNumber: req.params.twilioPhoneNumber,
        error: error.message,
        stack: error.stack,
        name: error.name
      });
      // Pass the original error to get more details
      next(error);
    }
  }

  /** Get app context by social sender (Messenger Facebook Page ID or Instagram Sender ID). Same payload as by-twilio for AI flow. */
  async getAppContextBySocialSender(req, res, next) {
    try {
      const { socialSenderId } = req.params;
      if (!socialSenderId) {
        return next(new AppError('Social sender ID (Facebook Page ID or Instagram Sender ID) is required', 400));
      }
      const app = await App.findBySocialSenderId(socialSenderId)
        .populate('owner', 'firstName lastName professionDescription website')
        .select('_id name industry owner facebookPageId facebookPageName instagramBusinessAccountId +facebookPageAccessToken +instagramAccessToken')
        .exec();
      if (!app || !app.owner) {
        return next(new AppError('No app found with this sender ID', 404));
      }
      const user = app.owner;
      const appId = app._id;
      const cacheKey = cacheManager.getAppContextKey(appId);
      const cachedData = await cacheManager.get(cacheKey);
      if (cachedData) {
        logger.info('App context served from cache (by social sender)', { socialSenderId, appId });
        return res.status(200).json(cachedData);
      }
      const userApp = { _id: app._id, name: app.name, industry: app.industry };
      const treatmentPromise = Questionnaire.find({ owner: appId, type: QUESTIONNAIRE_TYPES.SERVICE_PLAN, isActive: true })
        .select('question answer attachedWorkflows')
        .populate('attachedWorkflows.workflowId', 'title question questionTypeId isRoot order')
        .sort({ updatedAt: -1 })
        .exec();
      const faqPromise = Questionnaire.find({ owner: appId, type: QUESTIONNAIRE_TYPES.FAQ, isActive: true })
        .select('question answer')
        .sort({ updatedAt: -1 })
        .exec();
      const integrationPromise = Integration.findOne({ owner: appId }).exec();
      const workflowPromise = ChatbotWorkflow.find({ owner: appId })
        .select('title question questionTypeId isRoot order workflowGroupId isActive')
        .sort({ order: 1, createdAt: 1 })
        .exec();
      const [treatmentDocs, faqDocs, integration, workflowDocs] = await Promise.all([
        treatmentPromise, faqPromise, integrationPromise, workflowPromise
      ]);
      const defaultQuestionType = await QuestionType.findOne({ isActive: true }).sort({ id: 1 }).select('id').lean();
      const defaultQuestionTypeId = defaultQuestionType?.id || 1;
      const treatmentPlans = treatmentDocs.map(d => ({
        question: d.question,
        answer: d.answer,
        attachedWorkflows: (d.attachedWorkflows || [])
          .filter(aw => aw.workflowId)
          .sort((a, b) => (a.order || 0) - (b.order || 0))
          .map(aw => ({
            workflowId: aw.workflowId._id || aw.workflowId,
            order: aw.order || 0,
            workflow: aw.workflowId ? {
              _id: aw.workflowId._id,
              title: aw.workflowId.title,
              question: aw.workflowId.question,
              questionTypeId: aw.workflowId.questionTypeId,
              isRoot: aw.workflowId.isRoot,
              order: aw.workflowId.order
            } : null
          }))
      }));
      const faq = faqDocs.map(d => ({ question: d.question, answer: d.answer }));
      const workflowMap = {};
      const rootWorkflows = [];
      workflowDocs.forEach(w => {
        const workflowData = {
          _id: w._id,
          title: w.title,
          question: w.question,
          questionTypeId: w.questionTypeId,
          isRoot: w.isRoot,
          order: w.order,
          workflowGroupId: w.workflowGroupId,
          isActive: w.isActive
        };
        if (w.isRoot || !w.workflowGroupId) {
          const groupId = w._id.toString();
          workflowMap[groupId] = { ...workflowData, questions: [] };
          rootWorkflows.push(workflowMap[groupId]);
        } else {
          const groupId = w.workflowGroupId ? w.workflowGroupId.toString() : w._id.toString();
          if (!workflowMap[groupId]) {
            const rootWorkflow = workflowDocs.find(rw =>
              (rw._id.toString() === groupId && rw.isRoot) ||
              (rw.workflowGroupId && rw.workflowGroupId.toString() === groupId && rw.isRoot)
            );
            if (rootWorkflow) {
              workflowMap[groupId] = {
                _id: rootWorkflow._id,
                title: rootWorkflow.title,
                question: rootWorkflow.question,
                questionTypeId: rootWorkflow.questionTypeId,
                isRoot: rootWorkflow.isRoot,
                order: rootWorkflow.order,
                workflowGroupId: rootWorkflow.workflowGroupId,
                isActive: rootWorkflow.isActive,
                questions: []
              };
              rootWorkflows.push(workflowMap[groupId]);
            } else {
              workflowMap[groupId] = {
                _id: groupId,
                title: 'Unnamed Workflow',
                question: '',
                questionTypeId: defaultQuestionTypeId,
                isRoot: true,
                order: 0,
                isActive: true,
                questions: []
              };
            }
          }
          workflowMap[groupId].questions.push(workflowData);
        }
      });
      rootWorkflows.forEach(workflow => {
        if (workflow.questions) {
          workflow.questions = workflow.questions
            .filter(q => q.isActive !== false)
            .sort((a, b) => (a.order || 0) - (b.order || 0));
        }
        if (workflow.isActive === false) {
          const index = rootWorkflows.indexOf(workflow);
          if (index > -1) rootWorkflows.splice(index, 1);
        }
      });
      treatmentPlans.forEach(plan => {
        if (plan.attachedWorkflows && Array.isArray(plan.attachedWorkflows)) {
          plan.attachedWorkflows.forEach(attachedFlow => {
            if (attachedFlow.workflow && attachedFlow.workflow._id) {
              const existingIndex = rootWorkflows.findIndex(w =>
                w._id && w._id.toString() === attachedFlow.workflow._id.toString()
              );
              if (existingIndex === -1) {
                rootWorkflows.push({
                  ...attachedFlow.workflow,
                  treatmentPlanOrder: attachedFlow.order || 0,
                  treatmentPlanId: plan.question,
                  questions: attachedFlow.workflow.questions || []
                });
              } else {
                rootWorkflows[existingIndex].treatmentPlanOrder = attachedFlow.order || 0;
                rootWorkflows[existingIndex].treatmentPlanId = plan.question;
              }
            }
          });
        }
      });
      rootWorkflows.sort((a, b) => {
        const aOrder = a.treatmentPlanOrder !== undefined ? a.treatmentPlanOrder : (a.order || 0);
        const bOrder = b.treatmentPlanOrder !== undefined ? b.treatmentPlanOrder : (b.order || 0);
        return aOrder !== bOrder ? aOrder - bOrder : (a.order || 0) - (b.order || 0);
      });
      const integrationData = integration ? {
        assistantName: integration.assistantName,
        companyName: integration.companyName || '',
        greeting: integration.greeting,
        validateEmail: integration.validateEmail,
        validatePhoneNumber: integration.validatePhoneNumber,
        googleReviewEnabled: !!integration.googleReviewEnabled,
        googleReviewUrl: integration.googleReviewUrl || null,
        calendarConnected: !!integration.googleCalendarConnected,
        calendarSlotMinutes: integration.calendarSlotMinutes ?? 30,
        leadTypeMessages: integration.leadTypeMessages || []
      } : {
        ...getDefaultIntegrationConfig(),
        leadTypeMessages: []
      };
      const responseData = {
        status: 'success',
        data: {
          user: {
            id: user._id,
            firstName: user.firstName,
            lastName: user.lastName,
            professionDescription: user.professionDescription,
            website: user.website
          },
          app: userApp ? { id: userApp._id, name: userApp.name, industry: userApp.industry } : null,
          leadTypes: getLeadTypesFromIntegration(integration),
          treatmentPlans,
          faq,
          integration: integrationData,
          workflows: rootWorkflows,
          country: process.env.COUNTRY,
          // Include Messenger credentials when this lookup is by Facebook Page ID
          messengerAccessToken: app.facebookPageAccessToken || null,
          // Include Instagram credentials when this lookup is by Instagram Business Account ID
          instagramBusinessAccountId: app.instagramBusinessAccountId || null,
          instagramAccessToken: app.instagramAccessToken || null
        }
      };
      await cacheManager.set(cacheKey, responseData, 300);
      logger.info('App context retrieved by social sender (app-wise)', { socialSenderId, appId, appName: app.name });
      res.status(200).json(responseData);
    } catch (error) {
      logger.error('Error retrieving app context by social sender', { socialSenderId: req.params.socialSenderId, error: error.message });
      next(error);
    }
  }

  /** Set this app as the one using the Twilio number (for webhooks/leads/flows). Clears usesTwilioNumber on other apps with the same number. */
  async setUsesTwilioNumber(req, res, next) {
    try {
      const userId = req.user.id;
      const { id } = req.params;

      const app = await AppController.verifyAppOwnership(id, userId);
      const num = (app.twilioPhoneNumber || app.whatsappNumber)?.trim?.();
      if (!num) {
        throw new AppError('This app has no WhatsApp/Twilio number configured. Add the same number used by your Twilio channel in App settings so leads and AI use this app.', 400);
      }

      app.usesTwilioNumber = true;
      await app.save();

      await App.updateMany(
        {
          owner: userId,
          _id: { $ne: app._id },
          $or: [ { whatsappNumber: num }, { twilioPhoneNumber: num } ]
        },
        { $set: { usesTwilioNumber: false } }
      );

      // Invalidate app context cache for all apps with this number so next by-twilio/context returns fresh data (correct app + lead types)
      const appsWithThisNumber = await App.find({
        owner: userId,
        $or: [ { whatsappNumber: num }, { twilioPhoneNumber: num } ]
      }).select('_id').lean();
      for (const a of appsWithThisNumber) {
        try {
          const key = cacheManager.getAppContextKey(a._id);
          await cacheManager.del(key);
        } catch (e) {
          logger.warn('Failed to invalidate app context cache', { appId: a._id, error: e?.message });
        }
      }
      logger.info(`Invalidated app context cache for ${appsWithThisNumber.length} app(s) with number ${num}`);

      // Tell AI to clear WhatsApp sessions for this number so next message gets fresh context (new app's lead types)
      // Use same signing secret as third-party API authentication
      // Use deployed AI service by default, can override with ASSISTLY_AI_BASE_URL env var
      const aiBaseUrl = (process.env.ASSISTLY_AI_BASE_URL || 'https://assistly-ai-eu.onrender.com').replace(/\/$/, '');
      const signingSecret = process.env.THIRD_PARTY_SIGNING_SECRET || '';
      if (aiBaseUrl) {
        try {
          const headers = { 'Content-Type': 'application/json' };
          if (signingSecret) headers['X-Invalidate-Sessions-Secret'] = signingSecret;
          const res = await fetch(`${aiBaseUrl}/api/v1/whatsapp/invalidate-sessions`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ twilio_phone: num })
          });
          if (res.ok) {
            const data = await res.json().catch(() => ({}));
            logger.info('AI WhatsApp sessions invalidated for number', { num, removed: data.removed_sessions });
          } else {
            logger.warn('AI invalidate-sessions returned non-OK', { status: res.status, num });
          }
        } catch (err) {
          logger.warn('Failed to invalidate AI WhatsApp sessions for number', { num, error: err?.message });
        }
      }

      logger.info(`App ${app.name} (${app._id}) set as using Twilio number by user ${userId}`);

      res.status(200).json({
        status: 'success',
        message: 'This app is now using the Twilio number for leads and flows',
        data: {
          app: {
            id: app._id,
            usesTwilioNumber: app.usesTwilioNumber
          }
        }
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Connect a Facebook Page to an existing app.
   * Exchanges the short-lived token for long-lived + page access token and stores only those.
   */
  async connectFacebook(req, res, next) {
    try {
      const userId = req.user.id;
      const { id } = req.params;
      const { shortLivedToken, pageId, pageName } = req.body || {};

      if (!shortLivedToken || !pageId) {
        throw new AppError('shortLivedToken and pageId are required', 400);
      }

      const app = await AppController.verifyAppOwnership(id, userId);

      const fbData = await AppController.exchangeAndGetPageToken(shortLivedToken, pageId);

      app.facebookPageId = String(pageId).trim();
      app.facebookPageName = fbData.pageName || pageName || null;
      app.facebookLongLivedToken = fbData.longLivedToken;
      app.facebookPageAccessToken = fbData.pageAccessToken;
      app.facebookTokenExpiry = fbData.tokenExpiry;

      // Fetch Instagram Business Account if the Page has Instagram linked (for Instagram DMs webhook)
      try {
        const igData = await AppController.fetchInstagramBusinessAccount(pageId, fbData.pageAccessToken);
        if (igData) {
          app.instagramBusinessAccountId = igData.instagramBusinessAccountId;
          app.instagramUsername = igData.instagramUsername;
          // Page access token works for both Messenger and Instagram when Page has Instagram linked
          app.instagramAccessToken = fbData.pageAccessToken;
          logger.info('Instagram Business Account linked to app', {
            appId: app._id,
            instagramBusinessAccountId: app.instagramBusinessAccountId,
            instagramUsername: app.instagramUsername
          });
        } else {
          app.instagramBusinessAccountId = null;
          app.instagramUsername = null;
          app.instagramAccessToken = null;
        }
      } catch (igErr) {
        logger.warn('Could not fetch Instagram for page (non-fatal)', {
          pageId,
          error: igErr?.message
        });
        app.instagramBusinessAccountId = null;
        app.instagramUsername = null;
        app.instagramAccessToken = null;
      }

      await app.save();

      // Invalidate any cached app context so new tokens are picked up where relevant
      try {
        const key = cacheManager.getAppContextKey(app._id);
        await cacheManager.del(key);
      } catch (e) {
        logger.warn('Failed to invalidate app context cache after Facebook connect', {
          appId: app._id,
          error: e?.message
        });
      }

      logger.info('Facebook page connected to app', {
        appId: app._id,
        facebookPageId: app.facebookPageId,
        facebookPageName: app.facebookPageName
      });

      // Best-effort: subscribe the page to the Meta webhook configured for this app.
      try {
        const subscriptionResult = await AppController.subscribePageWebhook(
          app.facebookPageId,
          app.facebookPageAccessToken
        );
        logger.info('Facebook page subscribed to webhook', {
          appId: app._id,
          facebookPageId: app.facebookPageId,
          result: subscriptionResult
        });
      } catch (subErr) {
        // Do not fail the whole connection if subscription fails; just log.
        logger.warn('Facebook page webhook subscription failed', {
          appId: app._id,
          facebookPageId: app.facebookPageId,
          error: subErr.message
        });
      }

      res.status(200).json({
        status: 'success',
        message: 'Facebook page connected successfully',
        data: {
          app: {
            id: app._id,
            facebookPageId: app.facebookPageId,
            facebookPageName: app.facebookPageName,
            facebookTokenExpiry: app.facebookTokenExpiry
          }
        }
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Disconnect any Facebook Page from this app and wipe stored tokens.
   */
  async disconnectFacebook(req, res, next) {
    try {
      const userId = req.user.id;
      const { id } = req.params;

      const app = await AppController.verifyAppOwnership(id, userId);

      app.facebookPageId = null;
      app.facebookPageName = null;
      app.facebookLongLivedToken = null;
      app.facebookPageAccessToken = null;
      app.facebookTokenExpiry = null;
      app.instagramBusinessAccountId = null;
      app.instagramUsername = null;
      app.instagramAccessToken = null;
      await app.save();

      try {
        const key = cacheManager.getAppContextKey(app._id);
        await cacheManager.del(key);
      } catch (e) {
        logger.warn('Failed to invalidate app context cache after Facebook disconnect', {
          appId: app._id,
          error: e?.message
        });
      }

      logger.info('Facebook page disconnected from app', { appId: app._id });

      res.status(200).json({
        status: 'success',
        message: 'Facebook page disconnected successfully'
      });
    } catch (error) {
      next(error);
    }
  }
}

const appController = new AppController();

// Routes: literal paths first so they are not matched by /:id (e.g. "available-numbers")
router.get('/available-numbers', authenticateToken, appController.getAvailableNumbers);
router.post('/whatsapp/sender-status', (req, res, next) => appController.whatsappSenderStatusCallback(req, res, next));
router.post('/provision-number', authenticateToken, appController.provisionNumber);
router.post('/register-sender-after-meta', authenticateToken, appController.registerSenderAfterMeta);
router.post('/', authenticateToken, appController.createApp);
router.get('/', authenticateToken, appController.getApps);
router.get('/by-twilio/:twilioPhoneNumber/context', verifySignedThirdPartyForParamUser, appController.getAppContextByTwilioNumber);
router.get('/by-social-sender/:socialSenderId/context', verifySignedThirdPartyForParamUser, appController.getAppContextBySocialSender);
// More specific routes must come before generic :id routes
router.post('/:id/facebook/connect', authenticateToken, appController.connectFacebook.bind(appController));
router.post('/:id/facebook/disconnect', authenticateToken, appController.disconnectFacebook.bind(appController));
router.post('/:id/restore', authenticateToken, appController.restoreApp);
router.post('/:id/assign-number', authenticateToken, appController.assignNumber);
router.post('/:id/whatsapp/register', authenticateToken, appController.registerWhatsApp);
router.post('/:id/whatsapp/verify', authenticateToken, appController.verifyWhatsApp);
router.post('/:id/set-uses-twilio', authenticateToken, appController.setUsesTwilioNumber);
router.get('/:id', authenticateToken, appController.getApp);
router.put('/:id', authenticateToken, appController.updateApp);
router.delete('/:id', authenticateToken, appController.deleteApp);

module.exports = router;
