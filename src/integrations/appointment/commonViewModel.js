/**
 * Common view model for all appointment-scheduler integrations.
 * Every provider (Google Calendar, Outlook, Calendly, etc.) must return these fixed shapes
 * so that API consumers (AI, frontend) always expect the same fields.
 */

/** @typedef {import('./commonViewModel').AvailabilityViewModel} AvailabilityViewModel */
/** @typedef {import('./commonViewModel').BookAppointmentViewModel} BookAppointmentViewModel */
/** @typedef {import('./commonViewModel').CancelAppointmentViewModel} CancelAppointmentViewModel */

/**
 * Response shape for GetAvailableAppointments / getAvailableSlots.
 * @typedef {Object} AvailabilityViewModel
 * @property {boolean} success
 * @property {boolean} calendarConnected
 * @property {string} [provider] - 'google_calendar' | 'outlook' | 'calendly'
 * @property {string} [timeMin] - ISO 8601
 * @property {string} [timeMax] - ISO 8601
 * @property {Array<{ start: string, end: string }>} freeSlots - ISO 8601
 * @property {Array<{ start: string, end: string }>} busy
 * @property {string} [message]
 * @property {string} [error]
 */

/**
 * Response shape for BookAppointment.
 * @typedef {Object} BookAppointmentViewModel
 * @property {boolean} success
 * @property {string} [eventId]
 * @property {string} [link] - URL to view event
 * @property {string} [start] - ISO 8601
 * @property {string} [end] - ISO 8601
 * @property {string} [title]
 * @property {string} [provider]
 * @property {string} [error]
 */

/**
 * Response shape for CancelAppointment.
 * @typedef {Object} CancelAppointmentViewModel
 * @property {boolean} success
 * @property {boolean} [cancelled]
 * @property {string} [provider]
 * @property {string} [error]
 */

const PROVIDER_GOOGLE = 'google_calendar';
const PROVIDER_OUTLOOK = 'outlook';
const PROVIDER_CALENDLY = 'calendly';

/**
 * Build a standard availability response (success).
 * @param {Object} opts
 * @param {string} [opts.provider]
 * @param {string} [opts.timeMin]
 * @param {string} [opts.timeMax]
 * @param {Array<{ start: string, end: string }>} [opts.freeSlots]
 * @param {Array<{ start: string, end: string }>} [opts.busy]
 * @returns {AvailabilityViewModel}
 */
function availabilitySuccess(opts = {}) {
  return {
    success: true,
    calendarConnected: true,
    provider: opts.provider,
    timeMin: opts.timeMin,
    timeMax: opts.timeMax,
    freeSlots: opts.freeSlots || [],
    busy: opts.busy || [],
    message: opts.message
  };
}

/**
 * Build a standard availability response (not connected or error).
 * @param {Object} opts
 * @param {boolean} [opts.calendarConnected=false]
 * @param {string} [opts.message]
 * @param {string} [opts.error]
 * @returns {AvailabilityViewModel}
 */
function availabilityNotConnectedOrError(opts = {}) {
  return {
    success: opts.calendarConnected === true,
    calendarConnected: opts.calendarConnected || false,
    freeSlots: [],
    busy: [],
    message: opts.message,
    error: opts.error
  };
}

/**
 * Build a standard book-appointment success response.
 * @param {Object} opts
 * @param {string} [opts.eventId]
 * @param {string} [opts.link]
 * @param {string} [opts.start]
 * @param {string} [opts.end]
 * @param {string} [opts.title]
 * @param {string} [opts.provider]
 * @returns {BookAppointmentViewModel}
 */
function bookAppointmentSuccess(opts = {}) {
  return {
    success: true,
    eventId: opts.eventId,
    link: opts.link,
    start: opts.start,
    end: opts.end,
    title: opts.title,
    provider: opts.provider
  };
}

/**
 * Build a standard book-appointment error response.
 * @param {string} error
 * @param {string} [provider]
 * @returns {BookAppointmentViewModel}
 */
function bookAppointmentError(error, provider) {
  return {
    success: false,
    error: error || 'Failed to book appointment',
    provider
  };
}

/**
 * Build a standard cancel-appointment success response.
 * @param {Object} opts
 * @param {string} [opts.provider]
 * @returns {CancelAppointmentViewModel}
 */
function cancelAppointmentSuccess(opts = {}) {
  return {
    success: true,
    cancelled: true,
    provider: opts.provider
  };
}

/**
 * Build a standard cancel-appointment error response.
 * @param {string} error
 * @param {string} [provider]
 * @returns {CancelAppointmentViewModel}
 */
function cancelAppointmentError(error, provider) {
  return {
    success: false,
    cancelled: false,
    error: error || 'Failed to cancel appointment',
    provider
  };
}

module.exports = {
  PROVIDER_GOOGLE,
  PROVIDER_OUTLOOK,
  PROVIDER_CALENDLY,
  availabilitySuccess,
  availabilityNotConnectedOrError,
  bookAppointmentSuccess,
  bookAppointmentError,
  cancelAppointmentSuccess,
  cancelAppointmentError
};
