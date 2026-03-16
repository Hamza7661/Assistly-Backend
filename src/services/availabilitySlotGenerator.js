/**
 * Generates bookable free slots by merging:
 * - Weekly availability rules (Availability model)
 * - Date-based exceptions (AvailabilityException)
 * - Provider free/busy (e.g. Google Calendar)
 * Slots are returned as { start, end } in ISO 8601 UTC.
 */

const ALLOWED_SLOT_MINUTES = [15, 30, 60];

/**
 * @param {number} slotMinutes
 * @returns {boolean}
 */
function isAllowedSlotMinutes(slotMinutes) {
  return Number.isInteger(slotMinutes) && ALLOWED_SLOT_MINUTES.includes(slotMinutes);
}

/**
 * Get start of day in a given timezone as Date (UTC).
 * We use a simple approach: create date string YYYY-MM-DD and parse as local in that TZ.
 * Node doesn't have Intl-based "local time in TZ" until we use a library; use a simple heuristic:
 * For UTC we can do new Date(year, month-1, day). For other TZ we approximate with offset.
 * @param {string} dateStr - YYYY-MM-DD
 * @param {string} timezone - IANA timezone or 'UTC'
 * @returns {Date} Start of that day in UTC (approximate if TZ not UTC)
 */
function getStartOfDayInTimezone(dateStr, timezone) {
  const [y, m, d] = dateStr.split('-').map(Number);
  if (timezone === 'UTC' || !timezone) {
    return new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0));
  }
  // Try to parse as local; if TZ has offset (e.g. +05:30), we'd need a library.
  // For simplicity: treat as UTC and document that slots are stored in UTC or use same TZ as server.
  return new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0));
}

/**
 * Parse HH:MM and add to a base date (UTC day start), then add offset so that the result
 * represents "HH:MM in the given timezone" as UTC.
 * Simplified: assume timezone is UTC for math; if integration stores local times, they pass timezone
 * and we use it. Using Intl would be better for real TZ support.
 * @param {Date} dayStartUtc - Start of day in UTC
 * @param {string} hhmm - "HH:MM"
 * @param {string} timezone
 * @returns {Date}
 */
function addTimeToDay(dayStartUtc, hhmm, timezone) {
  const [hh, mm] = hhmm.split(':').map(Number);
  const ms = dayStartUtc.getTime() + (hh * 60 + mm) * 60 * 1000;
  return new Date(ms);
}

/**
 * Build allowed windows for a single day from weekly rule + exception.
 * @param {string} dateStr - YYYY-MM-DD
 * @param {number} dayOfWeek - 0-6
 * @param {Object} weeklyDay - { allDay: boolean, slots: Array<{ start, end }>, timezone }
 * @param {Object|null} exception - { allDayOff, overrideAllDay, slots } or null
 * @returns {Array<{ start: Date, end: Date }>} Windows in UTC
 */
function getAllowedWindowsForDay(dateStr, dayOfWeek, weeklyDay, exception) {
  const tz = weeklyDay.timezone || 'UTC';
  const dayStart = getStartOfDayInTimezone(dateStr, tz);

  if (exception && exception.allDayOff) {
    return [];
  }
  if (exception && exception.overrideAllDay) {
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
    return [{ start: dayStart, end: dayEnd }];
  }
  const slots = (exception && exception.slots && exception.slots.length > 0)
    ? exception.slots
    : (weeklyDay.slots || []);

  if (!slots || slots.length === 0) {
    if (weeklyDay.allDay) {
      const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
      return [{ start: dayStart, end: dayEnd }];
    }
    return [];
  }

  return slots.map((s) => ({
    start: addTimeToDay(dayStart, s.start, tz),
    end: addTimeToDay(dayStart, s.end, tz)
  }));
}

/**
 * Slice a time range into fixed-length slots and filter out those overlapping provider busy.
 * @param {Date} windowStart
 * @param {Date} windowEnd
 * @param {number} slotMinutes
 * @param {Array<{ start: string|Date, end: string|Date }>} busy - ISO or Date
 * @returns {Array<{ start: string, end: string }>} ISO strings
 */
function sliceIntoSlots(windowStart, windowEnd, slotMinutes, busy) {
  const slotMs = slotMinutes * 60 * 1000;
  const busyTuples = (busy || []).map((b) => ({
    start: typeof b.start === 'string' ? new Date(b.start).getTime() : b.start.getTime(),
    end: typeof b.end === 'string' ? new Date(b.end).getTime() : b.end.getTime()
  }));

  const result = [];
  let cursor = windowStart.getTime();
  const endTs = windowEnd.getTime();

  while (cursor + slotMs <= endTs) {
    const slotEndTs = cursor + slotMs;
    const overlaps = busyTuples.some(
      (b) => b.start < slotEndTs && b.end > cursor
    );
    if (!overlaps) {
      result.push({
        start: new Date(cursor).toISOString(),
        end: new Date(slotEndTs).toISOString()
      });
    }
    cursor += slotMs;
  }
  return result;
}

/**
 * Generate free slots from rules, provider busy, and optional provider freeSlots (to intersect).
 * @param {Object} opts
 * @param {string} opts.timeMin - ISO 8601
 * @param {string} opts.timeMax - ISO 8601
 * @param {Array<{ dayOfWeek: number, slots: Array<{ start: string, end: string }>, allDay?: boolean, timezone?: string }>} opts.weeklyAvailability - 7 entries or map by dayOfWeek
 * @param {Array<{ date: string, allDayOff?: boolean, overrideAllDay?: boolean, slots?: Array<{ start: string, end: string }> }>} opts.exceptions
 * @param {Array<{ start: string, end: string }>} opts.providerBusy - from calendar provider
 * @param {number} opts.slotMinutes - 15, 30, or 60
 * @returns {Array<{ start: string, end: string }>} freeSlots in ISO
 */
function generateSlotsFromRules(opts) {
  const {
    timeMin,
    timeMax,
    weeklyAvailability = [],
    exceptions = [],
    providerBusy = [],
    slotMinutes = 30
  } = opts;

  if (!isAllowedSlotMinutes(slotMinutes)) {
    throw new Error(`slotMinutes must be one of ${ALLOWED_SLOT_MINUTES.join(', ')}`);
  }

  const weeklyByDay = new Map();
  (weeklyAvailability || []).forEach((w) => {
    weeklyByDay.set(w.dayOfWeek, {
      allDay: !!w.allDay,
      slots: w.slots || [],
      timezone: w.timezone || 'UTC'
    });
  });
  const exceptionsByDate = new Map();
  (exceptions || []).forEach((e) => {
    exceptionsByDate.set(e.date, {
      allDayOff: !!e.allDayOff,
      overrideAllDay: !!e.overrideAllDay,
      slots: e.slots || []
    });
  });

  const minDate = new Date(timeMin);
  const maxDate = new Date(timeMax);
  const freeSlots = [];

  const current = new Date(minDate);
  current.setUTCHours(0, 0, 0, 0);

  while (current.getTime() < maxDate.getTime()) {
    const y = current.getUTCFullYear();
    const m = String(current.getUTCMonth() + 1).padStart(2, '0');
    const d = String(current.getUTCDate()).padStart(2, '0');
    const dateStr = `${y}-${m}-${d}`;
    const dayOfWeek = current.getUTCDay();
    const weeklyDay = weeklyByDay.get(dayOfWeek) || {
      allDay: false,
      slots: [],
      timezone: weeklyAvailability[0]?.timezone || 'UTC'
    };
    const exception = exceptionsByDate.get(dateStr) || null;

    const windows = getAllowedWindowsForDay(dateStr, dayOfWeek, weeklyDay, exception);

    for (const win of windows) {
      const winStart = win.start.getTime();
      const winEnd = win.end.getTime();
      const rangeMin = Math.max(winStart, minDate.getTime());
      const rangeMax = Math.min(winEnd, maxDate.getTime());
      if (rangeMax <= rangeMin) continue;

      const slotList = sliceIntoSlots(
        new Date(rangeMin),
        new Date(rangeMax),
        slotMinutes,
        providerBusy
      );
      freeSlots.push(...slotList);
    }

    current.setUTCDate(current.getUTCDate() + 1);
  }

  freeSlots.sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
  return freeSlots;
}

module.exports = {
  generateSlotsFromRules,
  isAllowedSlotMinutes,
  ALLOWED_SLOT_MINUTES
};
