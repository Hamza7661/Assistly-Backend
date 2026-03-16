const { BaseAppointmentSchedulerProvider } = require('../IAppointmentSchedulerProvider');
const {
  availabilityNotConnectedOrError,
  bookAppointmentError,
  cancelAppointmentError,
  PROVIDER_OUTLOOK
} = require('../commonViewModel');

/**
 * Outlook Calendar implementation of IAppointmentSchedulerProvider.
 * Single responsibility: Microsoft Graph / Outlook Calendar only.
 * Stub: returns not-connected until implemented; same CommonViewModel contract.
 */
class OutlookAppointmentProvider extends BaseAppointmentSchedulerProvider {
  constructor(credentials) {
    super(PROVIDER_OUTLOOK, credentials);
  }

  async getAvailableSlots(timeMin, timeMax) {
    return availabilityNotConnectedOrError({
      message: 'Outlook Calendar integration is not yet implemented. Connect Google Calendar or check back later.'
    });
  }

  async bookAppointment(payload) {
    return bookAppointmentError('Outlook Calendar integration is not yet implemented.', PROVIDER_OUTLOOK);
  }

  async cancelAppointment() {
    return cancelAppointmentError('Outlook Calendar integration is not yet implemented.', PROVIDER_OUTLOOK);
  }
}

module.exports = { OutlookAppointmentProvider };
