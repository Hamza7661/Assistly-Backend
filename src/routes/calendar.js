const express = require('express');
const { AppError } = require('../utils/errorHandler');
const { verifySignedThirdPartyForParamUser } = require('../middleware/thirdParty');
const { Integration } = require('../models/Integration');
const { Availability } = require('../models/Availability');
const { AvailabilityException } = require('../models/AvailabilityException');
const { getAppointmentSchedulerProvider, PROVIDER_GOOGLE, PROVIDER_OUTLOOK } = require('../integrations/appointment/appointmentSchedulerFactory');
const { availabilitySuccess, availabilityNotConnectedOrError } = require('../integrations/appointment/commonViewModel');
const { generateSlotsFromRules, isAllowedSlotMinutes } = require('../services/availabilitySlotGenerator');
const { logger } = require('../utils/logger');

const router = express.Router();

/**
 * Resolve integration and return provider instance + credentials for the app's calendar.
 * Returns { provider, integration } or { provider: null, integration }.
 */
async function getProviderForApp(appId) {
  const integration = await Integration.findOne({ owner: appId })
    .select('googleCalendarConnected outlookCalendarConnected calendlyConnected calendarProvider googleCalendarRefreshToken googleCalendarCalendarId outlookCalendarRefreshToken outlookCalendarCalendarId calendarSlotMinutes')
    .lean()
    .exec();

  const providerType = integration?.calendarProvider || (integration?.googleCalendarRefreshToken ? PROVIDER_GOOGLE : null);
  const hasGoogleToken = !!integration?.googleCalendarRefreshToken;
  const hasOutlookToken = !!integration?.outlookCalendarRefreshToken;
  const connectedByFlag = !!(integration?.googleCalendarConnected || integration?.outlookCalendarConnected || integration?.calendlyConnected);
  // Backward compatibility: old records only had googleCalendarConnected.
  const connected = connectedByFlag && (hasGoogleToken || hasOutlookToken);

  if (!connected || !providerType) {
    return { provider: null, integration };
  }

  let credentials = null;
  if (providerType === PROVIDER_GOOGLE) {
    credentials = {
      encryptedRefreshToken: integration.googleCalendarRefreshToken,
      calendarId: integration.googleCalendarCalendarId || 'primary'
    };
  } else if (providerType === PROVIDER_OUTLOOK) {
    credentials = {
      encryptedRefreshToken: integration.outlookCalendarRefreshToken,
      calendarId: integration.outlookCalendarCalendarId || 'primary'
    };
  }

  if (!credentials?.encryptedRefreshToken) {
    return { provider: null, integration };
  }

  const provider = getAppointmentSchedulerProvider(providerType, credentials);
  return { provider, integration };
}

/**
 * GET /apps/:appId/availability
 * Query: from, to (ISO), slotMinutes (optional). Uses app availability rules + calendar provider.
 * Returns CommonViewModel (AvailabilityViewModel) with freeSlots from rules and provider busy.
 */
router.get('/apps/:appId/availability', verifySignedThirdPartyForParamUser, async (req, res, next) => {
  try {
    const appId = req.params.appId;
    const fromParam = req.query.from || req.query.timeMin;
    const toParam = req.query.to || req.query.timeMax;
    let slotMinutes = parseInt(req.query.slotMinutes, 10);

    if (!appId) return next(new AppError('App ID is required', 400));

    const { provider, integration } = await getProviderForApp(appId);

    if (!Number.isInteger(slotMinutes) || !isAllowedSlotMinutes(slotMinutes)) {
      slotMinutes = integration?.calendarSlotMinutes ?? 30;
    }
    if (!isAllowedSlotMinutes(slotMinutes)) {
      slotMinutes = 30;
    }

    const now = new Date();
    const defaultFrom = new Date(now);
    defaultFrom.setHours(0, 0, 0, 0);
    const defaultTo = new Date(defaultFrom);
    defaultTo.setDate(defaultTo.getDate() + 7);

    const timeMin = fromParam ? new Date(fromParam).toISOString() : defaultFrom.toISOString();
    const timeMax = toParam ? new Date(toParam).toISOString() : defaultTo.toISOString();

    const fromDateStr = timeMin.slice(0, 10);
    const toDateStr = timeMax.slice(0, 10);

    const [weeklyDocs, exceptionDocs] = await Promise.all([
      Availability.find({ owner: appId }).sort({ dayOfWeek: 1 }).select('dayOfWeek timezone slots allDay').lean().exec(),
      AvailabilityException.find({ owner: appId, date: { $gte: fromDateStr, $lte: toDateStr } })
        .select('date timezone allDayOff overrideAllDay slots').lean().exec()
    ]);

    const weeklyAvailability = weeklyDocs.map((d) => ({
      dayOfWeek: d.dayOfWeek,
      timezone: d.timezone || 'UTC',
      allDay: !!d.allDay,
      slots: d.slots || []
    }));
    const exceptions = exceptionDocs.map((d) => ({
      date: d.date,
      allDayOff: !!d.allDayOff,
      overrideAllDay: !!d.overrideAllDay,
      slots: d.slots || []
    }));

    let providerBusy = [];
    let baseViewModel = { success: true, calendarConnected: false, freeSlots: [], busy: [] };

    if (provider) {
      baseViewModel = await provider.getAvailableSlots(timeMin, timeMax, { slotMinutes });
      providerBusy = baseViewModel.busy || [];
    } else {
      baseViewModel = availabilityNotConnectedOrError({ message: 'No calendar connected for this app.' });
    }

    const freeSlots = generateSlotsFromRules({
      timeMin,
      timeMax,
      weeklyAvailability,
      exceptions,
      providerBusy,
      slotMinutes
    });

    const viewModel = {
      ...baseViewModel,
      freeSlots,
      calendarConnected: !!provider
    };

    res.status(200).json({
      status: 'success',
      data: viewModel
    });
  } catch (err) {
    logger.error('Calendar availability error', { appId: req.params.appId, error: err.message });
    if (err.code === 401 || (err.message && err.message.includes('invalid_grant'))) {
      return next(new AppError('Calendar access expired or revoked. Please reconnect your calendar.', 401));
    }
    next(err);
  }
});

/**
 * POST /apps/:appId/appointments
 * Body: { start, end, title, attendeeEmail?, description? } (ISO dates).
 * Returns CommonViewModel (BookAppointmentViewModel).
 */
router.post('/apps/:appId/appointments', verifySignedThirdPartyForParamUser, async (req, res, next) => {
  try {
    const appId = req.params.appId;
    const { start, end, title, attendeeEmail, description, timeZone } = req.body || {};

    if (!appId) return next(new AppError('App ID is required', 400));
    if (!start || !end || !title) {
      return next(new AppError('start, end, and title are required', 400));
    }

    const { provider } = await getProviderForApp(appId);
    if (!provider) {
      return res.status(200).json({
        status: 'success',
        data: { success: false, error: 'No calendar connected for this app.', calendarConnected: false }
      });
    }

    const viewModel = await provider.bookAppointment({
      start,
      end,
      title,
      attendeeEmail,
      description,
      timeZone
    });

    res.status(viewModel.success ? 201 : 200).json({
      status: viewModel.success ? 'success' : 'error',
      data: viewModel
    });
  } catch (err) {
    logger.error('Calendar book appointment error', { appId: req.params.appId, error: err.message });
    next(err);
  }
});

/**
 * DELETE /apps/:appId/appointments/:eventId
 * Returns CommonViewModel (CancelAppointmentViewModel).
 */
router.delete('/apps/:appId/appointments/:eventId', verifySignedThirdPartyForParamUser, async (req, res, next) => {
  try {
    const appId = req.params.appId;
    const eventId = req.params.eventId;

    if (!appId || !eventId) return next(new AppError('App ID and event ID are required', 400));

    const { provider } = await getProviderForApp(appId);
    if (!provider) {
      return res.status(200).json({
        status: 'success',
        data: { success: false, cancelled: false, error: 'No calendar connected for this app.' }
      });
    }

    const viewModel = await provider.cancelAppointment(eventId);

    res.status(200).json({
      status: viewModel.success ? 'success' : 'error',
      data: viewModel
    });
  } catch (err) {
    logger.error('Calendar cancel appointment error', { appId: req.params.appId, error: err.message });
    next(err);
  }
});

module.exports = router;
