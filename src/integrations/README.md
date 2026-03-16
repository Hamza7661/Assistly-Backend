# Integrations

All integrations follow a **fixed interface and common return type** so API consumers (AI, frontend) always receive the same fields. Each integration has **single responsibility** (one provider per type). New providers are added via a **factory** without changing callers.

## Appointment scheduler (calendar)

- **Interface:** `IAppointmentSchedulerProvider` — all methods return a **common view model** (from `commonViewModel.js`):  
  - `getAvailableSlots(timeMin, timeMax, options)` → common view model  
  - `bookAppointment(payload)` → common view model  
  - `cancelAppointment(eventId)` → common view model
- **Common view model:** `integrations/appointment/commonViewModel.js` — fixed shapes for success/error so all providers return the same fields.
- **Implementations:** `GoogleCalendarProvider`, `OutlookAppointmentProvider` (stub), etc. in `appointment/providers/`.
- **Factory:** `getAppointmentSchedulerProvider(providerType, credentials)` in `appointment/appointmentSchedulerFactory.js`.

Routes (`/api/v1/calendar/apps/:appId/...`) use the factory and return only the common view model. To add Outlook or Calendly: implement the same three methods returning the same view model and register in the factory.

## Adding another integration type (e.g. CRM)

Reuse the same pattern:

1. Define a **common view model** (fixed response fields) for that domain.
2. Define an **interface** (e.g. `ICRMSystemProvider`) with the methods and return types.
3. Implement **providers** (e.g. `SalesforceProvider`, `ZohoProvider`) with single responsibility.
4. Add a **factory** that returns the correct provider from config.
5. Expose **one set of routes** that call the factory and return only the common view model.

This keeps the API stable and makes it easy to add new providers or new integration types (e.g. email, CRM, payments) in the same way.
