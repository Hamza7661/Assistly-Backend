/**
 * Contract for appointment-scheduler integrations.
 * All providers (Google Calendar, Outlook, Calendly, etc.) must implement this interface
 * and return the CommonViewModel shapes from commonViewModel.js.
 *
 * @interface IAppointmentSchedulerProvider
 *
 * @method getAvailableSlots
 * @param {string} timeMin - ISO 8601
 * @param {string} timeMax - ISO 8601
 * @param {{ slotMinutes?: number }} [options]
 * @returns {Promise<AvailabilityViewModel>}
 *
 * @method bookAppointment
 * @param {{ start: string, end: string, title: string, attendeeEmail?: string, description?: string }} payload
 * @returns {Promise<BookAppointmentViewModel>}
 *
 * @method cancelAppointment
 * @param {string} eventId
 * @returns {Promise<CancelAppointmentViewModel>}
 */

const { availabilityNotConnectedOrError, bookAppointmentError, cancelAppointmentError } = require('./commonViewModel');

/**
 * Base "interface" implementation that throws if a provider forgets to implement a method.
 * Each concrete provider extends or composes this and overrides the three methods.
 */
class BaseAppointmentSchedulerProvider {
  constructor(providerName, credentials) {
    this.providerName = providerName;
    this.credentials = credentials;
  }

  async getAvailableSlots(timeMin, timeMax, options = {}) {
    throw new Error(`${this.constructor.name} must implement getAvailableSlots(timeMin, timeMax, options)`);
  }

  async bookAppointment(payload) {
    throw new Error(`${this.constructor.name} must implement bookAppointment(payload)`);
  }

  async cancelAppointment(eventId) {
    throw new Error(`${this.constructor.name} must implement cancelAppointment(eventId)`);
  }
}

module.exports = {
  BaseAppointmentSchedulerProvider,
  availabilityNotConnectedOrError,
  bookAppointmentError,
  cancelAppointmentError
};
