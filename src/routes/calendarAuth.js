/**
 * Calendar OAuth connect/disconnect. Used by the frontend to attach a calendar (e.g. Google).
 * On connect we set provider-specific calendar connected flags and store encrypted token.
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
const { PROVIDER_GOOGLE, PROVIDER_OUTLOOK } = require('../integrations/appointment/appointmentSchedulerFactory');
const { getCalendarAccountEmail } = require('../services/outlookCalendarService');

const router = express.Router();

const SCOPES = [
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/userinfo.email'
];
const OUTLOOK_SCOPES = [
  'offline_access',
  'openid',
  'profile',
  'email',
  'https://graph.microsoft.com/User.Read',
  'https://graph.microsoft.com/Calendars.Read',
  'https://graph.microsoft.com/Calendars.ReadWrite'
];

function sanitizeEnv(value) {
  return String(value || '').trim().replace(/^["']|["']$/g, '');
}

function resolveOutlookTenantId() {
  const t = sanitizeEnv(process.env.OUTLOOK_CALENDAR_TENANT_ID);
  return t || 'common';
}

function resolveProvider(req) {
  const raw = (req.query.provider || req.body?.provider || PROVIDER_GOOGLE).toString().trim().toLowerCase();
  const outlookAliases = new Set([
    PROVIDER_OUTLOOK,
    'microsoft',
    'office365',
    'm365',
    'ms'
  ]);
  if (outlookAliases.has(raw)) return PROVIDER_OUTLOOK;
  return PROVIDER_GOOGLE;
}

function encodeState(stateObj) {
  return Buffer.from(JSON.stringify(stateObj), 'utf8').toString('base64url');
}

function decodeState(state) {
  try {
    const decoded = Buffer.from(state, 'base64url').toString('utf8');
    // backward compatibility for old state format where state was only appId
    if (decoded.startsWith('{')) return JSON.parse(decoded);
    return { appId: decoded, provider: PROVIDER_GOOGLE };
  } catch (_) {
    return null;
  }
}

/** Normalize client-sent IANA timezone for OAuth state / storage. */
function normalizeClientTimezone(raw) {
  const s = String(raw || '').trim();
  if (!s || s.length > 100) return null;
  if (!/^[A-Za-z0-9/_+\-]+$/.test(s)) return null;
  return s;
}

function readClientTimezoneFromRequest(req) {
  const q = req.query || {};
  return normalizeClientTimezone(q.timezone || q.connectedCalendarTimezone);
}

function buildIntegrationRedirect(frontendBase, calendarStatus) {
  try {
    const base = new URL(frontendBase || 'http://localhost:3000');
    const normalizedPath = base.pathname.replace(/\/+$/, '');
    base.pathname = normalizedPath.endsWith('/integration') ? normalizedPath : '/integration';
    base.search = '';
    base.hash = '';
    base.searchParams.set('calendar', calendarStatus);
    return base.toString();
  } catch (_) {
    const fallbackBase = String(frontendBase || 'http://localhost:3000').replace(/\/+$/, '');
    const withoutDupIntegration = fallbackBase.endsWith('/integration')
      ? fallbackBase
      : `${fallbackBase}/integration`;
    return `${withoutDupIntegration}?calendar=${encodeURIComponent(calendarStatus)}`;
  }
}

/**
 * GET /apps/:appId/calendar/auth
 * Redirects to Google OAuth. state = appId so callback knows which app to update.
 */
router.get('/apps/:appId/calendar/auth', authenticateToken, verifyAppOwnership, (req, res, next) => {
  try {
    const appId = req.appId || req.params.appId;
    if (!appId) return next(new AppError('App ID is required', 400));
    const provider = resolveProvider(req);
    const connectedCalendarTimezone = readClientTimezoneFromRequest(req);

    if (provider === PROVIDER_OUTLOOK) {
      const clientId = sanitizeEnv(process.env.OUTLOOK_CALENDAR_CLIENT_ID);
      const tenantId = resolveOutlookTenantId();
      const redirectUri = sanitizeEnv(process.env.OUTLOOK_CALENDAR_REDIRECT_URI || `${process.env.APP_URL || 'http://localhost:5000'}/api/v1/integration/calendar/callback`);
      if (!clientId) {
        return next(new AppError('Outlook Calendar OAuth is not configured. Set OUTLOOK_CALENDAR_CLIENT_ID.', 503));
      }

      const state = encodeState({ appId: String(appId), provider: PROVIDER_OUTLOOK, connectedCalendarTimezone });
      const authorizeUrl = new URL(`https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/authorize`);
      authorizeUrl.searchParams.set('client_id', clientId);
      authorizeUrl.searchParams.set('response_type', 'code');
      authorizeUrl.searchParams.set('redirect_uri', redirectUri);
      authorizeUrl.searchParams.set('response_mode', 'query');
      authorizeUrl.searchParams.set('scope', OUTLOOK_SCOPES.join(' '));
      authorizeUrl.searchParams.set('prompt', 'select_account');
      authorizeUrl.searchParams.set('state', state);
      return res.redirect(authorizeUrl.toString());
    }

    const clientId = (process.env.GOOGLE_CALENDAR_CLIENT_ID || '').trim().replace(/^["']|["']$/g, '');
    const clientSecret = (process.env.GOOGLE_CALENDAR_CLIENT_SECRET || '').trim().replace(/^["']|["']$/g, '');
    const redirectUri = (process.env.GOOGLE_CALENDAR_REDIRECT_URI || `${process.env.APP_URL || 'https://upzilo-backend.onrender.com'}/api/v1/integration/calendar/callback`).trim().replace(/^["']|["']$/g, '');
    if (!clientId || !clientSecret) {
      return next(new AppError('Google Calendar OAuth is not configured. Set GOOGLE_CALENDAR_CLIENT_ID and GOOGLE_CALENDAR_CLIENT_SECRET.', 503));
    }

    const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
    const state = encodeState({ appId: String(appId), provider: PROVIDER_GOOGLE, connectedCalendarTimezone });
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
    const provider = resolveProvider(req);
    const connectedCalendarTimezone = readClientTimezoneFromRequest(req);

    if (provider === PROVIDER_OUTLOOK) {
      const clientId = sanitizeEnv(process.env.OUTLOOK_CALENDAR_CLIENT_ID);
      const tenantId = resolveOutlookTenantId();
      const redirectUri = sanitizeEnv(process.env.OUTLOOK_CALENDAR_REDIRECT_URI || `${process.env.APP_URL || 'http://localhost:5000'}/api/v1/integration/calendar/callback`);
      if (!clientId) {
        return next(new AppError('Outlook Calendar OAuth is not configured.', 503));
      }
      const state = encodeState({ appId: String(appId), provider: PROVIDER_OUTLOOK, connectedCalendarTimezone });
      const authorizeUrl = new URL(`https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/authorize`);
      authorizeUrl.searchParams.set('client_id', clientId);
      authorizeUrl.searchParams.set('response_type', 'code');
      authorizeUrl.searchParams.set('redirect_uri', redirectUri);
      authorizeUrl.searchParams.set('response_mode', 'query');
      authorizeUrl.searchParams.set('scope', OUTLOOK_SCOPES.join(' '));
      authorizeUrl.searchParams.set('prompt', 'select_account');
      authorizeUrl.searchParams.set('state', state);
      return res.status(200).json({ status: 'success', data: { url: authorizeUrl.toString() } });
    }

    const clientId = (process.env.GOOGLE_CALENDAR_CLIENT_ID || '').trim().replace(/^["']|["']$/g, '');
    const clientSecret = (process.env.GOOGLE_CALENDAR_CLIENT_SECRET || '').trim().replace(/^["']|["']$/g, '');
    const redirectUri = (process.env.GOOGLE_CALENDAR_REDIRECT_URI || `${process.env.APP_URL || 'https://upzilo-backend.onrender.com'}/api/v1/integration/calendar/callback`).trim().replace(/^["']|["']$/g, '');
    if (!clientId || !clientSecret) {
      return next(new AppError('Google Calendar OAuth is not configured.', 503));
    }

    const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
    const state = encodeState({ appId: String(appId), provider: PROVIDER_GOOGLE, connectedCalendarTimezone });
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
    const successUrl = buildIntegrationRedirect(frontendBase, 'connected');
    const failureUrl = buildIntegrationRedirect(frontendBase, 'error');

    if (error) {
      logger.warn('Calendar OAuth provider returned error', { error });
      return res.redirect(failureUrl);
    }
    if (!code || !state) {
      return res.redirect(failureUrl);
    }

    const parsedState = decodeState(state);
    if (!parsedState?.appId) {
      return res.redirect(failureUrl);
    }
    const appId = parsedState.appId;
    const provider = parsedState.provider === PROVIDER_OUTLOOK ? PROVIDER_OUTLOOK : PROVIDER_GOOGLE;
    const connectedCalendarTimezone = normalizeClientTimezone(parsedState.connectedCalendarTimezone) || null;

    let refreshToken = null;
    let calendarAccountEmail = null;
    if (provider === PROVIDER_OUTLOOK) {
      const clientId = sanitizeEnv(process.env.OUTLOOK_CALENDAR_CLIENT_ID);
      const clientSecret = sanitizeEnv(process.env.OUTLOOK_CALENDAR_CLIENT_SECRET);
      const tenantId = resolveOutlookTenantId();
      const redirectUri = sanitizeEnv(process.env.OUTLOOK_CALENDAR_REDIRECT_URI || `${process.env.APP_URL || 'http://localhost:5000'}/api/v1/integration/calendar/callback`);
      if (!clientId || !clientSecret) {
        return res.redirect(failureUrl);
      }
      const tokenUrl = `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`;
      const body = new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'authorization_code',
        code: String(code),
        redirect_uri: redirectUri,
        scope: OUTLOOK_SCOPES.join(' ')
      });
      const tokenRes = await fetch(tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body
      });
      if (!tokenRes.ok) {
        const text = await tokenRes.text().catch(() => '');
        logger.warn('Outlook Calendar getToken failed', { status: tokenRes.status, body: text });
        return res.redirect(failureUrl);
      }
      const tokenJson = await tokenRes.json();
      refreshToken = tokenJson.refresh_token || null;
      if (refreshToken) {
        calendarAccountEmail = await getCalendarAccountEmail(encrypt(refreshToken));
      }
    } else {
      const clientId = (process.env.GOOGLE_CALENDAR_CLIENT_ID || '').trim().replace(/^["']|["']$/g, '');
      const clientSecret = (process.env.GOOGLE_CALENDAR_CLIENT_SECRET || '').trim().replace(/^["']|["']$/g, '');
      const redirectUri = (process.env.GOOGLE_CALENDAR_REDIRECT_URI || `${process.env.APP_URL || 'https://upzilo-backend.onrender.com'}/api/v1/integration/calendar/callback`).trim().replace(/^["']|["']$/g, '');
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
      refreshToken = tokens.refresh_token;
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
    }

    if (!refreshToken) {
      logger.warn(`${provider} OAuth: no refresh_token in response`);
      return res.redirect(failureUrl);
    }

    const encrypted = encrypt(refreshToken);
    if (!encrypted) {
      logger.warn('Calendar token encryption key not set, cannot store token', { provider });
      return res.redirect(failureUrl);
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

    const calendarUpdate = {
      googleCalendarRefreshToken: provider === PROVIDER_GOOGLE ? encrypted : null,
      googleCalendarCalendarId: provider === PROVIDER_GOOGLE ? 'primary' : null,
      outlookCalendarRefreshToken: provider === PROVIDER_OUTLOOK ? encrypted : null,
      outlookCalendarCalendarId: provider === PROVIDER_OUTLOOK ? 'primary' : null,
      googleCalendarConnected: provider === PROVIDER_GOOGLE,
      outlookCalendarConnected: provider === PROVIDER_OUTLOOK,
      calendlyConnected: false,
      calendarProvider: provider,
      calendarAccountEmail: calendarAccountEmail || null
    };
    if (connectedCalendarTimezone != null) {
      calendarUpdate.connectedCalendarTimezone = connectedCalendarTimezone;
    }

    await Integration.findOneAndUpdate({ owner: appId }, calendarUpdate, { new: true });

    try {
      await cacheManager.del(cacheManager.getAppContextKey(appId));
    } catch (_) {}

    logger.info('Calendar connected for app', { appId, provider });
    res.redirect(successUrl);
  } catch (err) {
    logger.error('Calendar callback error', { error: err.message, stack: err.stack, code: err.code });
    const frontendBase = process.env.FRONTEND_BASE_URL || process.env.FRONTEND_URL || 'http://localhost:3000';
    res.redirect(buildIntegrationRedirect(frontendBase, 'error'));
  }
});

/**
 * DELETE /apps/:appId/calendar
 * Disconnect calendar: clear tokens and reset all provider-specific flags.
 */
router.delete('/apps/:appId/calendar', authenticateToken, verifyAppOwnership, async (req, res, next) => {
  try {
    const appId = req.appId || req.params.appId;
    if (!appId) return next(new AppError('App ID is required', 400));

    await Integration.findOneAndUpdate(
      { owner: appId },
      {
        googleCalendarRefreshToken: null,
        outlookCalendarRefreshToken: null,
        googleCalendarConnected: false,
        outlookCalendarConnected: false,
        calendlyConnected: false,
        calendarProvider: null,
        calendarAccountEmail: null,
        connectedCalendarTimezone: null,
        googleCalendarTimezone: null
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
