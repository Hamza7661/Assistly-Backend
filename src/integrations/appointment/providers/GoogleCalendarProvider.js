const { BaseAppointmentSchedulerProvider, bookAppointmentError, cancelAppointmentError } = require('../IAppointmentSchedulerProvider');
const {
  availabilitySuccess,
  availabilityNotConnectedOrError,
  bookAppointmentSuccess,
  cancelAppointmentSuccess,
  PROVIDER_GOOGLE
} = require('../commonViewModel');
const { getFreebusy, computeFreeSlots, createEvent, deleteEvent } = require('../../../services/googleCalendarService');

/**
 * Google Calendar implementation of IAppointmentSchedulerProvider.
 * Single responsibility: Google Calendar API only; returns CommonViewModel shapes.
 */
class GoogleCalendarProvider extends BaseAppointmentSchedulerProvider {
  constructor(credentials) {
    super(PROVIDER_GOOGLE, credentials);
    this.encryptedRefreshToken = credentials.encryptedRefreshToken;
    this.calendarId = credentials.calendarId || 'primary';
  }

  /**
   * @returns {Promise<AvailabilityViewModel>}
   */
  async getAvailableSlots(timeMin, timeMax, options = {}) {
    const slotMinutes = options.slotMinutes || 30;
    if (!this.encryptedRefreshToken) {
      return availabilityNotConnectedOrError({ message: 'Google Calendar not connected.' });
    }
    try {
      const result = await getFreebusy(
        this.encryptedRefreshToken,
        this.calendarId,
        timeMin,
        timeMax
      );
      if (!result) {
        return availabilityNotConnectedOrError({ message: 'Could not read Google Calendar.' });
      }
      const freeSlots = computeFreeSlots(timeMin, timeMax, result.busy || [], slotMinutes);
      return availabilitySuccess({
        provider: PROVIDER_GOOGLE,
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

  /**
   * @returns {Promise<BookAppointmentViewModel>}
   */
  async bookAppointment(payload) {
    if (!this.encryptedRefreshToken) {
      return bookAppointmentError('Google Calendar not connected.', PROVIDER_GOOGLE);
    }
    try {
      const result = await createEvent(this.encryptedRefreshToken, this.calendarId, {
        start: payload.start,
        end: payload.end,
        title: payload.title || 'Appointment',
        description: payload.description,
        attendeeEmail: payload.attendeeEmail,
        timeZone: payload.timeZone
      });
      if (!result) {
        return bookAppointmentError('Could not create event.', PROVIDER_GOOGLE);
      }
      return bookAppointmentSuccess({
        eventId: result.eventId,
        link: result.link,
        start: result.start,
        end: result.end,
        title: result.title,
        provider: PROVIDER_GOOGLE
      });
    } catch (err) {
      return bookAppointmentError(err.message || 'Failed to book appointment', PROVIDER_GOOGLE);
    }
  }

  /**
   * @returns {Promise<CancelAppointmentViewModel>}
   */
  async cancelAppointment(eventId) {
    if (!this.encryptedRefreshToken) {
      return cancelAppointmentError('Google Calendar not connected.', PROVIDER_GOOGLE);
    }
    try {
      await deleteEvent(this.encryptedRefreshToken, this.calendarId, eventId);
      return cancelAppointmentSuccess({ provider: PROVIDER_GOOGLE });
    } catch (err) {
      return cancelAppointmentError(err.message || 'Failed to cancel appointment', PROVIDER_GOOGLE);
    }
  }
}

module.exports = { GoogleCalendarProvider };
