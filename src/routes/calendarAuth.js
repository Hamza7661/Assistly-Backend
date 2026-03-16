/**
 * Calendar OAuth connect/disconnect. Used by the frontend to attach a calendar (e.g. Google).
 * On connect we set calendarProvider + googleCalendarConnected and store encrypted refresh token.
 */
const express = require('express');
const { google } = require('googleapis');
const { AppError } = require('../utils/errorHandler');
const { authenticateToken } = require('../middleware/auth');
const { verifyAppOwnership } = require('../middleware/appOwnership');
const { Integration } = require('../models/Integration');
const { encrypt } = require('../utils/encrypt');
const cacheManager = require('../utils/cache');
const { logger } = require('../utils/logger');
const { PROVIDER_GOOGLE } = require('../integrations/appointment/appointmentSchedulerFactory');

const router = express.Router();

const SCOPES = [
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/userinfo.email'
];

/**
 * GET /apps/:appId/calendar/auth
 * Redirects to Google OAuth. state = appId so callback knows which app to update.
 */
router.get('/apps/:appId/calendar/auth', authenticateToken, verifyAppOwnership, (req, res, next) => {
  try {
    const appId = req.appId || req.params.appId;
    if (!appId) return next(new AppError('App ID is required', 400));

    const clientId = (process.env.GOOGLE_CALENDAR_CLIENT_ID || '').trim().replace(/^["']|["']$/g, '');
    const clientSecret = (process.env.GOOGLE_CALENDAR_CLIENT_SECRET || '').trim().replace(/^["']|["']$/g, '');
    const redirectUri = (process.env.GOOGLE_CALENDAR_REDIRECT_URI || `${process.env.APP_URL || 'http://localhost:5000'}/api/v1/integration/calendar/callback`).trim().replace(/^["']|["']$/g, '');
    if (!clientId || !clientSecret) {
      return next(new AppError('Google Calendar OAuth is not configured. Set GOOGLE_CALENDAR_CLIENT_ID and GOOGLE_CALENDAR_CLIENT_SECRET.', 503));
    }

    const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
    const state = Buffer.from(String(appId), 'utf8').toString('base64url');
    const url = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: SCOPES,
      state
    });

    res.redirect(url);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /apps/:appId/calendar/auth-url
 * Returns { url } for the frontend to redirect the user (so the request can send Bearer token).
 */
router.get('/apps/:appId/calendar/auth-url', authenticateToken, verifyAppOwnership, (req, res, next) => {
  try {
    const appId = req.appId || req.params.appId;
    if (!appId) return next(new AppError('App ID is required', 400));

    const clientId = (process.env.GOOGLE_CALENDAR_CLIENT_ID || '').trim().replace(/^["']|["']$/g, '');
    const clientSecret = (process.env.GOOGLE_CALENDAR_CLIENT_SECRET || '').trim().replace(/^["']|["']$/g, '');
    const redirectUri = (process.env.GOOGLE_CALENDAR_REDIRECT_URI || `${process.env.APP_URL || 'http://localhost:5000'}/api/v1/integration/calendar/callback`).trim().replace(/^["']|["']$/g, '');
    if (!clientId || !clientSecret) {
      return next(new AppError('Google Calendar OAuth is not configured.', 503));
    }

    const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
    const state = Buffer.from(String(appId), 'utf8').toString('base64url');
    const url = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: SCOPES,
      state
    });

    res.status(200).json({ status: 'success', data: { url } });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /integration/calendar/callback
 * Google redirects here with ?code=...&state=appIdBase64. Exchange code, store token, redirect to frontend.
 */
router.get('/calendar/callback', async (req, res, next) => {
  try {
    const { code, state, error } = req.query;
    const frontendBase = process.env.FRONTEND_BASE_URL || process.env.FRONTEND_URL || 'http://localhost:3000';
    const successUrl = `${frontendBase.replace(/\/$/, '')}/integration?calendar=connected`;
    const failureUrl = `${frontendBase.replace(/\/$/, '')}/integration?calendar=error`;

    if (error) {
      logger.warn('Google Calendar OAuth error', { error });
      return res.redirect(failureUrl);
    }
    if (!code || !state) {
      return res.redirect(failureUrl);
    }

    let appId;
    try {
      appId = Buffer.from(state, 'base64url').toString('utf8');
    } catch (_) {
      return res.redirect(failureUrl);
    }

    const clientId = (process.env.GOOGLE_CALENDAR_CLIENT_ID || '').trim().replace(/^["']|["']$/g, '');
    const clientSecret = (process.env.GOOGLE_CALENDAR_CLIENT_SECRET || '').trim().replace(/^["']|["']$/g, '');
    const redirectUri = (process.env.GOOGLE_CALENDAR_REDIRECT_URI || `${process.env.APP_URL || 'http://localhost:5000'}/api/v1/integration/calendar/callback`).trim().replace(/^["']|["']$/g, '');
    if (!clientId || !clientSecret) {
      return res.redirect(failureUrl);
    }

    const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
    let tokens;
    try {
      const result = await oauth2Client.getToken(code);
      tokens = result.tokens;
    } catch (tokenErr) {
      logger.warn('Google Calendar getToken failed', {
        message: tokenErr.message,
        code: tokenErr.code,
        response: tokenErr.response?.data,
        clientIdPrefix: clientId ? `${clientId.substring(0, 25)}...` : '(empty)',
        clientSecretLength: clientSecret.length,
        redirectUri
      });
      return res.redirect(failureUrl);
    }

    const refreshToken = tokens.refresh_token;
    if (!refreshToken) {
      logger.warn('Google Calendar OAuth: no refresh_token in response (user may have already authorized; try revoking app access at myaccount.google.com/permissions and connect again)');
      return res.redirect(failureUrl);
    }

    const encrypted = encrypt(refreshToken);
    if (!encrypted) {
      logger.warn('Google Calendar: encryption key not set, cannot store token');
      return res.redirect(failureUrl);
    }

    let calendarAccountEmail = null;
    try {
      oauth2Client.setCredentials(tokens);
      const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
      const userinfo = await oauth2.userinfo.get();
      if (userinfo.data && userinfo.data.email) {
        calendarAccountEmail = userinfo.data.email;
      }
    } catch (emailErr) {
      logger.warn('Google Calendar: could not fetch account email', { message: emailErr.message });
    }

    let integration = await Integration.findOne({ owner: appId });
    if (!integration) {
      integration = new Integration({
        owner: appId,
        chatbotImage: { data: null, contentType: null, filename: null },
        assistantName: 'Assistant',
        companyName: '',
        greeting: process.env.DEFAULT_GREETING || 'Hi this is {assistantName} your virtual ai assistant from {companyName}. How can I help you today?',
        primaryColor: process.env.DEFAULT_PRIMARY_COLOR || '#3B82F6',
        validateEmail: true,
        validatePhoneNumber: true
      });
      await integration.save();
    }

    await Integration.findOneAndUpdate(
      { owner: appId },
      {
        googleCalendarRefreshToken: encrypted,
        googleCalendarConnected: true,
        calendarProvider: PROVIDER_GOOGLE,
        googleCalendarCalendarId: 'primary',
        calendarAccountEmail: calendarAccountEmail || null
      },
      { new: true }
    );

    try {
      await cacheManager.del(cacheManager.getAppContextKey(appId));
    } catch (_) {}

    logger.info('Google Calendar connected for app', { appId });
    res.redirect(successUrl);
  } catch (err) {
    logger.error('Calendar callback error', { error: err.message, stack: err.stack, code: err.code });
    const frontendBase = process.env.FRONTEND_BASE_URL || process.env.FRONTEND_URL || 'http://localhost:3000';
    res.redirect(`${frontendBase.replace(/\/$/, '')}/integration?calendar=error`);
  }
});

/**
 * DELETE /apps/:appId/calendar
 * Disconnect calendar: clear token, set calendarConnected false and calendarProvider null.
 */
router.delete('/apps/:appId/calendar', authenticateToken, verifyAppOwnership, async (req, res, next) => {
  try {
    const appId = req.appId || req.params.appId;
    if (!appId) return next(new AppError('App ID is required', 400));

    await Integration.findOneAndUpdate(
      { owner: appId },
      {
        googleCalendarRefreshToken: null,
        googleCalendarConnected: false,
        calendarProvider: null,
        calendarAccountEmail: null
      },
      { new: true }
    );

    try {
      await cacheManager.del(cacheManager.getAppContextKey(appId));
    } catch (_) {}

    logger.info('Calendar disconnected for app', { appId });
    res.status(200).json({ status: 'success', data: { calendarConnected: false } });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
