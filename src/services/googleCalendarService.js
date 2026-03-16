const { google } = require('googleapis');
const { decrypt } = require('../utils/encrypt');
const { logger } = require('../utils/logger');

/**
 * Get OAuth2 client for Google Calendar using stored refresh token.
 * @param {string} encryptedRefreshToken - Encrypted refresh token from Integration
 * @returns {Promise<import('google-auth-library').OAuth2Client|null>} Authorized client or null
 */
async function getOAuth2Client(encryptedRefreshToken) {
  const refreshToken = decrypt(encryptedRefreshToken);
  if (!refreshToken) {
    logger.warn('Google Calendar: could not decrypt refresh token or key not set');
    return null;
  }
  const clientId = process.env.GOOGLE_CALENDAR_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CALENDAR_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    logger.warn('Google Calendar: GOOGLE_CALENDAR_CLIENT_ID or GOOGLE_CALENDAR_CLIENT_SECRET not set');
    return null;
  }
  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, process.env.GOOGLE_CALENDAR_REDIRECT_URI || 'http://localhost');
  oauth2Client.setCredentials({ refresh_token: refreshToken });
  return oauth2Client;
}

/**
 * Fetch free/busy from Google Calendar for the given calendar ID and time range.
 * @param {string} encryptedRefreshToken
 * @param {string} calendarId - e.g. 'primary' or full email
 * @param {string} timeMin - ISO 8601 / RFC3339
 * @param {string} timeMax - ISO 8601 / RFC3339
 * @returns {Promise<{ busy: Array<{ start: string, end: string }>, freeSlots?: Array<{ start: string, end: string }> }|null>}
 */
async function getFreebusy(encryptedRefreshToken, calendarId, timeMin, timeMax) {
  const auth = await getOAuth2Client(encryptedRefreshToken);
  if (!auth) return null;
  const calendar = google.calendar({ version: 'v3', auth });
  try {
    const res = await calendar.freebusy.query({
      requestBody: {
        timeMin,
        timeMax,
        items: [{ id: calendarId || 'primary' }]
      }
    });
    const cal = res.data.calendars && res.data.calendars[calendarId || 'primary'];
    if (!cal) {
      return { busy: [], freeSlots: [] };
    }
    const busy = (cal.busy || []).map((b) => ({ start: b.start, end: b.end }));
    return { busy };
  } catch (err) {
    logger.error('Google Calendar freebusy error', { message: err.message, calendarId });
    throw err;
  }
}

/**
 * Compute free slots in [timeMin, timeMax] by subtracting busy periods.
 * Splits by day and returns slots as { start, end } in ISO.
 * Optionally restrict to business hours (from Availability model) - caller can pass slots per day.
 * @param {string} timeMin - ISO
 * @param {string} timeMax - ISO
 * @param {Array<{ start: string, end: string }>} busy
 * @param {number} slotMinutes - minimum slot length (default 30)
 * @returns {Array<{ start: string, end: string }>} free slots
 */
function computeFreeSlots(timeMin, timeMax, busy, slotMinutes = 30) {
  const min = new Date(timeMin).getTime();
  const max = new Date(timeMax).getTime();
  const busySorted = [...busy]
    .map((b) => ({ start: new Date(b.start).getTime(), end: new Date(b.end).getTime() }))
    .filter((b) => b.end > min && b.start < max)
    .sort((a, b) => a.start - b.start);
  const merged = [];
  for (const b of busySorted) {
    if (merged.length && b.start <= merged[merged.length - 1].end) {
      merged[merged.length - 1].end = Math.max(merged[merged.length - 1].end, b.end);
    } else {
      merged.push({ start: b.start, end: b.end });
    }
  }
  const free = [];
  let cursor = min;
  const slotMs = slotMinutes * 60 * 1000;
  for (const b of merged) {
    while (cursor + slotMs <= b.start) {
      free.push({
        start: new Date(cursor).toISOString(),
        end: new Date(Math.min(cursor + slotMs, b.start)).toISOString()
      });
      cursor += slotMs;
    }
    cursor = Math.max(cursor, b.end);
  }
  while (cursor + slotMs <= max) {
    free.push({
      start: new Date(cursor).toISOString(),
      end: new Date(Math.min(cursor + slotMs, max)).toISOString()
    });
    cursor += slotMs;
  }
  return free;
}

/**
 * Create an event on Google Calendar.
 * @param {string} encryptedRefreshToken
 * @param {string} calendarId
 * @param {{ start: string, end: string, title: string, description?: string, attendeeEmail?: string }} payload
 * @returns {Promise<{ eventId: string, link?: string, start: string, end: string, title: string }|null>}
 */
async function createEvent(encryptedRefreshToken, calendarId, payload) {
  const auth = await getOAuth2Client(encryptedRefreshToken);
  if (!auth) return null;
  const calendar = google.calendar({ version: 'v3', auth });
  const resource = {
    summary: payload.title || 'Appointment',
    description: payload.description || '',
    start: { dateTime: payload.start, timeZone: 'UTC' },
    end: { dateTime: payload.end, timeZone: 'UTC' }
  };
  if (payload.attendeeEmail) {
    resource.attendees = [{ email: payload.attendeeEmail }];
  }
  try {
    const res = await calendar.events.insert({
      calendarId: calendarId || 'primary',
      requestBody: resource
    });
    const e = res.data;
    return {
      eventId: e.id,
      link: e.htmlLink || e.hangoutLink,
      start: e.start?.dateTime || e.start?.date,
      end: e.end?.dateTime || e.end?.date,
      title: e.summary || payload.title
    };
  } catch (err) {
    logger.error('Google Calendar createEvent error', { message: err.message });
    throw err;
  }
}

/**
 * Delete/cancel an event on Google Calendar.
 * @param {string} encryptedRefreshToken
 * @param {string} calendarId
 * @param {string} eventId
 * @returns {Promise<boolean>}
 */
async function deleteEvent(encryptedRefreshToken, calendarId, eventId) {
  const auth = await getOAuth2Client(encryptedRefreshToken);
  if (!auth) return false;
  const calendar = google.calendar({ version: 'v3', auth });
  try {
    await calendar.events.delete({
      calendarId: calendarId || 'primary',
      eventId
    });
    return true;
  } catch (err) {
    logger.error('Google Calendar deleteEvent error', { message: err.message, eventId });
    throw err;
  }
}

module.exports = {
  getOAuth2Client,
  getFreebusy,
  computeFreeSlots,
  createEvent,
  deleteEvent
};
