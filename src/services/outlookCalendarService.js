const { decrypt } = require('../utils/encrypt');
const { logger } = require('../utils/logger');
const { computeFreeSlots } = require('./googleCalendarService');

function getTenantId() {
  return (process.env.OUTLOOK_CALENDAR_TENANT_ID || 'common').trim();
}

function getClientId() {
  return (process.env.OUTLOOK_CALENDAR_CLIENT_ID || '').trim();
}

function getClientSecret() {
  return (process.env.OUTLOOK_CALENDAR_CLIENT_SECRET || '').trim();
}

function getTokenEndpoint() {
  const tenantId = encodeURIComponent(getTenantId());
  return `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
}

async function getAccessTokenFromRefreshToken(encryptedRefreshToken) {
  const refreshToken = decrypt(encryptedRefreshToken);
  if (!refreshToken) {
    logger.warn('Outlook Calendar: could not decrypt refresh token or key not set');
    return null;
  }

  const clientId = getClientId();
  const clientSecret = getClientSecret();
  if (!clientId || !clientSecret) {
    logger.warn('Outlook Calendar: OUTLOOK_CALENDAR_CLIENT_ID or OUTLOOK_CALENDAR_CLIENT_SECRET not set');
    return null;
  }

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    scope: 'offline_access User.Read Calendars.Read Calendars.ReadWrite'
  });

  const response = await fetch(getTokenEndpoint(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    logger.error('Outlook Calendar refresh token exchange failed', { status: response.status, body: text });
    return null;
  }

  const json = await response.json();
  return json?.access_token || null;
}

async function graphRequest(path, accessToken, options = {}) {
  const response = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    const error = new Error(`Graph API request failed (${response.status})`);
    error.status = response.status;
    error.responseBody = text;
    throw error;
  }

  if (response.status === 204) return null;
  return response.json();
}

async function getCalendarAccountEmail(encryptedRefreshToken) {
  const accessToken = await getAccessTokenFromRefreshToken(encryptedRefreshToken);
  if (!accessToken) return null;
  try {
    const me = await graphRequest('/me?$select=mail,userPrincipalName', accessToken);
    return me?.mail || me?.userPrincipalName || null;
  } catch (err) {
    logger.warn('Outlook Calendar: could not fetch account email', { message: err.message });
    return null;
  }
}

async function getFreebusy(encryptedRefreshToken, _calendarId, timeMin, timeMax) {
  const accessToken = await getAccessTokenFromRefreshToken(encryptedRefreshToken);
  if (!accessToken) return null;
  try {
    const start = encodeURIComponent(timeMin);
    const end = encodeURIComponent(timeMax);
    const data = await graphRequest(
      `/me/calendarView?startDateTime=${start}&endDateTime=${end}&$select=start,end,showAs`,
      accessToken
    );
    const busy = (data?.value || [])
      .filter((event) => (event?.showAs || '').toLowerCase() !== 'free')
      .map((event) => ({
        start: event?.start?.dateTime ? new Date(event.start.dateTime).toISOString() : null,
        end: event?.end?.dateTime ? new Date(event.end.dateTime).toISOString() : null
      }))
      .filter((slot) => slot.start && slot.end);
    return { busy };
  } catch (err) {
    logger.error('Outlook Calendar freebusy error', { message: err.message, responseBody: err.responseBody });
    throw err;
  }
}

async function createEvent(encryptedRefreshToken, _calendarId, payload) {
  const accessToken = await getAccessTokenFromRefreshToken(encryptedRefreshToken);
  if (!accessToken) return null;
  const body = {
    subject: payload.title || 'Appointment',
    body: {
      contentType: 'Text',
      content: payload.description || ''
    },
    start: {
      dateTime: payload.start,
      timeZone: 'UTC'
    },
    end: {
      dateTime: payload.end,
      timeZone: 'UTC'
    }
  };
  if (payload.attendeeEmail) {
    body.attendees = [
      {
        emailAddress: { address: payload.attendeeEmail },
        type: 'required'
      }
    ];
  }

  try {
    const event = await graphRequest('/me/events', accessToken, {
      method: 'POST',
      body: JSON.stringify(body)
    });
    return {
      eventId: event?.id,
      link: event?.webLink,
      start: event?.start?.dateTime ? new Date(event.start.dateTime).toISOString() : payload.start,
      end: event?.end?.dateTime ? new Date(event.end.dateTime).toISOString() : payload.end,
      title: event?.subject || payload.title
    };
  } catch (err) {
    logger.error('Outlook Calendar createEvent error', { message: err.message, responseBody: err.responseBody });
    throw err;
  }
}

async function deleteEvent(encryptedRefreshToken, _calendarId, eventId) {
  const accessToken = await getAccessTokenFromRefreshToken(encryptedRefreshToken);
  if (!accessToken) return false;
  try {
    await graphRequest(`/me/events/${encodeURIComponent(eventId)}`, accessToken, { method: 'DELETE' });
    return true;
  } catch (err) {
    logger.error('Outlook Calendar deleteEvent error', { message: err.message, eventId, responseBody: err.responseBody });
    throw err;
  }
}

module.exports = {
  getAccessTokenFromRefreshToken,
  getCalendarAccountEmail,
  getFreebusy,
  computeFreeSlots,
  createEvent,
  deleteEvent
};
