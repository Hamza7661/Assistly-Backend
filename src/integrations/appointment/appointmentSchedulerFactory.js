/**
 * Factory for IAppointmentSchedulerProvider implementations.
 * Returns the correct provider based on calendarProvider type; all return CommonViewModel.
 */
const { PROVIDER_GOOGLE, PROVIDER_OUTLOOK, PROVIDER_CALENDLY } = require('./commonViewModel');
const { GoogleCalendarProvider } = require('./providers/GoogleCalendarProvider');
const { OutlookAppointmentProvider } = require('./providers/OutlookAppointmentProvider');

/**
 * @param {string} providerType - 'google_calendar' | 'outlook' | 'calendly'
 * @param {Object} credentials - Provider-specific (e.g. { encryptedRefreshToken, calendarId } for Google)
 * @returns {import('./IAppointmentSchedulerProvider').BaseAppointmentSchedulerProvider|null}
 */
function getAppointmentSchedulerProvider(providerType, credentials) {
  if (!providerType || !credentials) return null;
  switch (providerType) {
    case PROVIDER_GOOGLE:
      return new GoogleCalendarProvider(credentials);
    case PROVIDER_OUTLOOK:
      return new OutlookAppointmentProvider(credentials);
    case PROVIDER_CALENDLY:
      // Stub: CalendlyProvider can be added same way
      return null;
    default:
      return null;
  }
}

module.exports = {
  getAppointmentSchedulerProvider,
  PROVIDER_GOOGLE,
  PROVIDER_OUTLOOK,
  PROVIDER_CALENDLY
};
