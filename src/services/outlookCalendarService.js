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

function readTokenClaims(accessToken) {
  try {
    const payload = String(accessToken || '').split('.')[1];
    if (!payload) return null;
    const json = Buffer.from(payload, 'base64url').toString('utf8');
    const claims = JSON.parse(json);
    return {
      aud: claims?.aud,
      iss: claims?.iss,
      tid: claims?.tid,
      scp: claims?.scp,
      roles: claims?.roles
    };
  } catch (_) {
    return null;
  }
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
    refresh_token: refreshToken
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
  const accessToken = String(json?.access_token || '').trim();
  const tokenType = String(json?.token_type || '').trim();
  if (!accessToken) {
    logger.error('Outlook Calendar refresh token exchange returned no access token');
    return null;
  }
  if (tokenType && tokenType.toLowerCase() !== 'bearer') {
    logger.warn('Outlook Calendar token type is not Bearer', { tokenType });
  }

  const claims = readTokenClaims(accessToken);
  const aud = String(claims?.aud || '');
  const scp = String(claims?.scp || '');
  if (aud && aud !== '00000003-0000-0000-c000-000000000000' && aud !== 'https://graph.microsoft.com') {
    logger.error('Outlook Calendar access token has unexpected audience', { aud, claims });
    return null;
  }
  if (!claims) {
    // Some Microsoft-issued tokens can be opaque/non-decodable in this environment.
    // We still send the bearer token to Graph and rely on Graph response for validation.
    logger.warn('Outlook Calendar token claims are not decodable; proceeding with bearer token');
  } else if (!scp && !Array.isArray(claims?.roles)) {
    logger.warn('Outlook Calendar token has no scp/roles claims; proceeding and letting Graph validate', { claims });
  }
  return accessToken;
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
    error.wwwAuthenticate = response.headers.get('www-authenticate') || '';
    error.tokenClaims = readTokenClaims(accessToken);
    throw error;
  }

  if (response.status === 204) return null;
  return response.json();
}

async function graphRequestWithAutoRefresh(path, encryptedRefreshToken, options = {}) {
  let accessToken = await getAccessTokenFromRefreshToken(encryptedRefreshToken);
  if (!accessToken) {
    throw new Error('Unable to obtain Outlook access token');
  }

  try {
    return await graphRequest(path, accessToken, options);
  } catch (err) {
    if (Number(err?.status) !== 401) throw err;

    // Force a second fresh token attempt in case the first token is stale/revoked.
    accessToken = await getAccessTokenFromRefreshToken(encryptedRefreshToken);
    if (!accessToken) throw err;

    try {
      return await graphRequest(path, accessToken, options);
    } catch (retryErr) {
      retryErr.firstAttempt = {
        status: err?.status,
        responseBody: err?.responseBody,
        wwwAuthenticate: err?.wwwAuthenticate,
        tokenClaims: err?.tokenClaims
      };
      throw retryErr;
    }
  }
}

async function getCalendarAccountEmail(encryptedRefreshToken) {
  try {
    const me = await graphRequestWithAutoRefresh('/me?$select=mail,userPrincipalName', encryptedRefreshToken);
    return me?.mail || me?.userPrincipalName || null;
  } catch (err) {
    logger.warn('Outlook Calendar: could not fetch account email', { message: err.message });
    return null;
  }
}

async function getFreebusy(encryptedRefreshToken, _calendarId, timeMin, timeMax) {
  try {
    const start = encodeURIComponent(timeMin);
    const end = encodeURIComponent(timeMax);
    const data = await graphRequestWithAutoRefresh(
      `/me/calendarView?startDateTime=${start}&endDateTime=${end}&$select=start,end,showAs`,
      encryptedRefreshToken
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

function shouldTryNextGraphPath(err) {
  return [401, 403, 404].includes(Number(err?.status));
}

function buildCreateEventPaths(calendarId, graphUserId) {
  const paths = [];
  const cal = String(calendarId || '').trim();
  if (cal && cal.toLowerCase() !== 'primary') {
    paths.push(`/me/calendars/${encodeURIComponent(cal)}/events`);
  }
  paths.push('/me/calendar/events');
  paths.push('/me/events');
  if (graphUserId) {
    const uid = encodeURIComponent(graphUserId);
    paths.push(`/users/${uid}/calendar/events`);
    paths.push(`/users/${uid}/events`);
  }
  return [...new Set(paths)];
}

async function createEvent(encryptedRefreshToken, _calendarId, payload) {
  const body = {
    subject: payload.title || 'Appointment',
    body: {
      contentType: 'Text',
      content: payload.description || ''
    },
    start: {
      dateTime: payload.start,
      timeZone: payload.timeZone || 'UTC'
    },
    end: {
      dateTime: payload.end,
      timeZone: payload.timeZone || 'UTC'
    },
    showAs: payload.showAs || 'busy',
    categories: Array.isArray(payload.categories) ? payload.categories : undefined
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
    let graphUserId = null;
    try {
      const me = await graphRequestWithAutoRefresh('/me?$select=id', encryptedRefreshToken);
      graphUserId = me?.id || null;
    } catch (_) {
      graphUserId = null;
    }

    let lastErr = null;
    const createPaths = buildCreateEventPaths(_calendarId, graphUserId);
    for (const path of createPaths) {
      try {
        const event = await graphRequestWithAutoRefresh(path, encryptedRefreshToken, {
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
        lastErr = err;
        if (!shouldTryNextGraphPath(err)) {
          throw err;
        }
      }
    }

    throw lastErr || new Error('Outlook Calendar createEvent failed for all Graph paths');
  } catch (err) {
    logger.error('Outlook Calendar createEvent error', {
      message: err.message,
      responseBody: err.responseBody,
      wwwAuthenticate: err.wwwAuthenticate,
      tokenClaims: err.tokenClaims,
      firstAttempt: err.firstAttempt
    });
    throw err;
  }
}

function buildLocalDateTime(date, hhmm) {
  return `${date}T${hhmm}:00`;
}


function createExceptionEventPayloads(exception) {
  const date = exception?.date;
  const timezone = (exception?.timezone || 'UTC').trim() || 'UTC';
  const label = (exception?.label || '').trim();
  if (!date) return [];

  if (exception?.allDayOff) {
    return [{
      title: label || 'Not Available',
      description: 'Assistly availability exception',
      start: buildLocalDateTime(date, '00:00'),
      end: buildLocalDateTime(date, '23:59'),
      timeZone: timezone,
      showAs: 'busy',
      categories: ['AssistlyAvailability']
    }];
  }

  if (exception?.overrideAllDay) {
    return [{
      title: label || 'Available',
      description: 'Assistly availability exception',
      start: buildLocalDateTime(date, '00:00'),
      end: buildLocalDateTime(date, '23:59'),
      timeZone: timezone,
      showAs: 'free',
      categories: ['AssistlyAvailability']
    }];
  }

  const slots = Array.isArray(exception?.slots) ? exception.slots : [];
  return slots
    .filter((s) => s?.start && s?.end)
    .map((slot) => ({
      title: label || 'Available',
      description: 'Assistly availability exception',
      start: buildLocalDateTime(date, slot.start),
      end: buildLocalDateTime(date, slot.end),
      timeZone: timezone,
      showAs: 'free',
      categories: ['AssistlyAvailability']
    }));
}

async function syncAvailabilityExceptionToOutlook({
  encryptedRefreshToken,
  calendarId,
  exception,
  existingEventIds = []
}) {
  if (!encryptedRefreshToken || !exception?.date) {
    return { synced: false, eventIds: [] };
  }

  // Remove previous Assistly-managed events for this exception date.
  for (const eventId of existingEventIds) {
    if (!eventId) continue;
    try {
      await deleteEvent(encryptedRefreshToken, calendarId, eventId);
    } catch (_) {
      // Ignore stale/deleted event errors; we'll recreate current projection.
    }
  }

  const payloads = createExceptionEventPayloads(exception);
  if (payloads.length === 0) {
    return { synced: true, eventIds: [] };
  }

  const created = [];
  for (const payload of payloads) {
    const result = await createEvent(encryptedRefreshToken, calendarId, payload);
    if (result?.eventId) created.push(result.eventId);
  }
  return { synced: true, eventIds: created };
}

async function deleteEvent(encryptedRefreshToken, _calendarId, eventId) {
  try {
    let graphUserId = null;
    try {
      const me = await graphRequestWithAutoRefresh('/me?$select=id', encryptedRefreshToken);
      graphUserId = me?.id || null;
    } catch (_) {
      graphUserId = null;
    }

    const basePaths = [
      `/me/events/${encodeURIComponent(eventId)}`,
      `/me/calendar/events/${encodeURIComponent(eventId)}`
    ];
    if (graphUserId) {
      basePaths.push(`/users/${encodeURIComponent(graphUserId)}/events/${encodeURIComponent(eventId)}`);
      basePaths.push(`/users/${encodeURIComponent(graphUserId)}/calendar/events/${encodeURIComponent(eventId)}`);
    }

    let deleted = false;
    let lastErr = null;
    for (const path of [...new Set(basePaths)]) {
      try {
        await graphRequestWithAutoRefresh(path, encryptedRefreshToken, { method: 'DELETE' });
        deleted = true;
        break;
      } catch (err) {
        lastErr = err;
        if (!shouldTryNextGraphPath(err)) {
          throw err;
        }
      }
    }
    if (!deleted && lastErr) throw lastErr;
    return true;
  } catch (err) {
    logger.error('Outlook Calendar deleteEvent error', {
      message: err.message,
      eventId,
      responseBody: err.responseBody,
      wwwAuthenticate: err.wwwAuthenticate,
      tokenClaims: err.tokenClaims,
      firstAttempt: err.firstAttempt
    });
    throw err;
  }
}

module.exports = {
  getAccessTokenFromRefreshToken,
  getCalendarAccountEmail,
  getFreebusy,
  computeFreeSlots,
  createEvent,
  deleteEvent,
  syncAvailabilityExceptionToOutlook
};
