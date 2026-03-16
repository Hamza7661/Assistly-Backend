/**
 * Appointment scheduler integration.
 * Fixed interface (IAppointmentSchedulerProvider) and CommonViewModel return types
 * so all providers (Google, Outlook, Calendly) expose the same fields.
 * Single responsibility per provider; add new providers via the factory.
 */
const { getAppointmentSchedulerProvider, PROVIDER_GOOGLE, PROVIDER_OUTLOOK, PROVIDER_CALENDLY } = require('./appointmentSchedulerFactory');
const {
  availabilitySuccess,
  availabilityNotConnectedOrError,
  bookAppointmentSuccess,
  bookAppointmentError,
  cancelAppointmentSuccess,
  cancelAppointmentError
} = require('./commonViewModel');
const { BaseAppointmentSchedulerProvider } = require('./IAppointmentSchedulerProvider');

module.exports = {
  getAppointmentSchedulerProvider,
  PROVIDER_GOOGLE,
  PROVIDER_OUTLOOK,
  PROVIDER_CALENDLY,
  commonViewModel: {
    availabilitySuccess,
    availabilityNotConnectedOrError,
    bookAppointmentSuccess,
    bookAppointmentError,
    cancelAppointmentSuccess,
    cancelAppointmentError
  },
  BaseAppointmentSchedulerProvider
};
