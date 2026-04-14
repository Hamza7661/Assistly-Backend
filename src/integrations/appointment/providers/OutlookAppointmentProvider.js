const { BaseAppointmentSchedulerProvider } = require('../IAppointmentSchedulerProvider');
const {
  availabilitySuccess,
  availabilityNotConnectedOrError,
  bookAppointmentSuccess,
  bookAppointmentError,
  cancelAppointmentSuccess,
  cancelAppointmentError,
  PROVIDER_OUTLOOK
} = require('../commonViewModel');
const {
  getFreebusy,
  computeFreeSlots,
  createEvent,
  deleteEvent
} = require('../../../services/outlookCalendarService');

/**
 * Outlook Calendar implementation of IAppointmentSchedulerProvider.
 * Single responsibility: Microsoft Graph / Outlook Calendar only.
 */
class OutlookAppointmentProvider extends BaseAppointmentSchedulerProvider {
  constructor(credentials) {
    super(PROVIDER_OUTLOOK, credentials);
    this.encryptedRefreshToken = credentials.encryptedRefreshToken;
    this.calendarId = credentials.calendarId || 'primary';
  }

  async getAvailableSlots(timeMin, timeMax, options = {}) {
    const slotMinutes = options.slotMinutes || 30;
    if (!this.encryptedRefreshToken) {
      return availabilityNotConnectedOrError({ message: 'Outlook Calendar not connected.' });
    }
    try {
      const result = await getFreebusy(
        this.encryptedRefreshToken,
        this.calendarId,
        timeMin,
        timeMax
      );
      if (!result) {
        return availabilityNotConnectedOrError({ message: 'Could not read Outlook Calendar.' });
      }
      const freeSlots = computeFreeSlots(timeMin, timeMax, result.busy || [], slotMinutes);
      return availabilitySuccess({
        provider: PROVIDER_OUTLOOK,
        timeMin,
        timeMax,
        freeSlots,
        busy: result.busy || []
      });
    } catch (err) {
      return availabilityNotConnectedOrError({
        calendarConnected: false,
        error: err.message || 'Failed to fetch availability'
      });
    }
  }

  async bookAppointment(payload) {
    if (!this.encryptedRefreshToken) {
      return bookAppointmentError('Outlook Calendar not connected.', PROVIDER_OUTLOOK);
    }
    try {
      const result = await createEvent(this.encryptedRefreshToken, this.calendarId, {
        start: payload.start,
        end: payload.end,
        title: payload.title || 'Appointment',
        description: payload.description,
        attendeeEmail: payload.attendeeEmail
      });
      if (!result) {
        return bookAppointmentError('Could not create event.', PROVIDER_OUTLOOK);
      }
      return bookAppointmentSuccess({
        eventId: result.eventId,
        link: result.link,
        start: result.start,
        end: result.end,
        title: result.title,
        provider: PROVIDER_OUTLOOK
      });
    } catch (err) {
      return bookAppointmentError(err.message || 'Failed to book appointment', PROVIDER_OUTLOOK);
    }
  }

  async cancelAppointment(eventId) {
    if (!this.encryptedRefreshToken) {
      return cancelAppointmentError('Outlook Calendar not connected.', PROVIDER_OUTLOOK);
    }
    try {
      await deleteEvent(this.encryptedRefreshToken, this.calendarId, eventId);
      return cancelAppointmentSuccess({ provider: PROVIDER_OUTLOOK });
    } catch (err) {
      return cancelAppointmentError(err.message || 'Failed to cancel appointment', PROVIDER_OUTLOOK);
    }
  }
}

module.exports = { OutlookAppointmentProvider };
