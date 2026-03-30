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
 * Uses Intl.DateTimeFormat to compute the exact UTC moment that corresponds to
 * midnight (00:00:00) on dateStr in the given IANA timezone.
 * @param {string} dateStr - YYYY-MM-DD
 * @param {string} timezone - IANA timezone or 'UTC'
 * @returns {Date} Start of that day in UTC
 */
function getStartOfDayInTimezone(dateStr, timezone) {
  const [y, m, d] = dateStr.split('-').map(Number);
  if (timezone === 'UTC' || !timezone) {
    return new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0));
  }
  try {
    // Reference: noon UTC on the target date avoids DST transitions (which typically happen at 2 AM).
    const noonUtc = new Date(Date.UTC(y, m - 1, d, 12, 0, 0, 0));
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
    const parts = fmt.formatToParts(noonUtc);
    const get = (type, fallback) => parseInt(parts.find((p) => p.type === type)?.value || fallback, 10);
    const localHour = get('hour', '12');
    const localMinute = get('minute', '0');
    const localSecond = get('second', '0');
    const localDay = get('day', String(d));
    const localMonth = get('month', String(m));
    const localYear = get('year', String(y));

    // Compute how many seconds past the target date's midnight the local clock shows at noon UTC.
    // For offsets > +12h the local day spills into the next calendar day — dayDiffMs handles that.
    const localDateMs = Date.UTC(localYear, localMonth - 1, localDay);
    const targetDateMs = Date.UTC(y, m - 1, d);
    const dayDiffSeconds = (localDateMs - targetDateMs) / 1000;
    const localSecondsFromTargetMidnight = dayDiffSeconds + localHour * 3600 + localMinute * 60 + localSecond;

    // offset = local - utc  =>  offsetMs = (localSecondsFromTargetMidnight - noon_seconds) * 1000
    const offsetMs = (localSecondsFromTargetMidnight - 12 * 3600) * 1000;

    // Midnight local time as UTC = UTC midnight − offset
    // e.g. Karachi +5h: 2026-03-30T00:00:00Z − 5h = 2026-03-29T19:00:00Z ✓
    // e.g. UTC-5:       2026-03-30T00:00:00Z + 5h = 2026-03-30T05:00:00Z ✓
    return new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0) - offsetMs);
  } catch (e) {
    return new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0));
  }
}

/**
 * Add a HH:MM offset to dayStartUtc (which is already the UTC equivalent of local midnight).
 * Because dayStartUtc represents 00:00 local time, adding HH:MM directly yields the correct UTC
 * moment for that local time — no further timezone adjustment is needed here.
 * @param {Date} dayStartUtc - UTC moment that equals midnight in the local timezone
 * @param {string} hhmm - "HH:MM" local time within the day
 * @returns {Date}
 */
function addTimeToDay(dayStartUtc, hhmm) {
  const [hh, mm] = hhmm.split(':').map(Number);
  return new Date(dayStartUtc.getTime() + (hh * 60 + mm) * 60 * 1000);
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
    start: addTimeToDay(dayStart, s.start),
    end: addTimeToDay(dayStart, s.end)
  }));
}

/**
 * Slice a time range into fixed-length slots and filter out those overlapping provider busy.
 * @param {Date} windowStart
 * @param {Date} windowEnd
 * @param {number} slotMinutes
 * @param {Array<{ start: string|Date, end: string|Date }>} busy - ISO or Date
 * @param {string} [timezone='UTC']
 * @returns {Array<{ start: string, end: string, timezone: string }>} ISO strings
 */
function sliceIntoSlots(windowStart, windowEnd, slotMinutes, busy, timezone = 'UTC') {
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
        end: new Date(slotEndTs).toISOString(),
        timezone
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
    slotMinutes = 30,
    defaultTimezone = null
  } = opts;

  if (!isAllowedSlotMinutes(slotMinutes)) {
    throw new Error(`slotMinutes must be one of ${ALLOWED_SLOT_MINUTES.join(', ')}`);
  }

  const tzFallback = defaultTimezone || 'UTC';

  const weeklyByDay = new Map();
  (weeklyAvailability || []).forEach((w) => {
    weeklyByDay.set(w.dayOfWeek, {
      allDay: !!w.allDay,
      slots: w.slots || [],
      timezone: w.timezone || tzFallback
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
      timezone: weeklyAvailability[0]?.timezone || tzFallback
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
        providerBusy,
        weeklyDay.timezone || 'UTC'
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
