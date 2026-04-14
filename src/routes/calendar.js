const express = require('express');
const { AppError } = require('../utils/errorHandler');
const { verifySignedThirdPartyForParamUser } = require('../middleware/thirdParty');
const { Integration } = require('../models/Integration');
const { Availability } = require('../models/Availability');
const { AvailabilityException } = require('../models/AvailabilityException');
const { App } = require('../models/App');
const { User } = require('../models/User');
const { Lead } = require('../models/Lead');
const { getAppointmentSchedulerProvider, PROVIDER_GOOGLE } = require('../integrations/appointment/appointmentSchedulerFactory');
const { availabilitySuccess, availabilityNotConnectedOrError } = require('../integrations/appointment/commonViewModel');
const { generateSlotsFromRules, isAllowedSlotMinutes } = require('../services/availabilitySlotGenerator');
const { logger } = require('../utils/logger');
const EmailService = require('../utils/emailService');

const router = express.Router();

/**
 * Resolve integration and return provider instance + credentials for the app's calendar.
 * Returns { provider, integration } or { provider: null, integration }.
 */
async function getProviderForApp(appId) {
  const integration = await Integration.findOne({ owner: appId })
    .select('googleCalendarConnected calendarProvider googleCalendarRefreshToken googleCalendarCalendarId calendarSlotMinutes googleCalendarTimezone')
    .lean()
    .exec();

  const connected = integration?.googleCalendarConnected && integration?.googleCalendarRefreshToken;
  const providerType = integration?.calendarProvider || (connected ? PROVIDER_GOOGLE : null);

  if (!connected || !providerType) {
    return { provider: null, integration };
  }

  const credentials = {
    encryptedRefreshToken: integration.googleCalendarRefreshToken,
    calendarId: integration.googleCalendarCalendarId || 'primary'
  };
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

    const calendarTimezone = integration?.googleCalendarTimezone || null;

    const freeSlots = generateSlotsFromRules({
      timeMin,
      timeMax,
      weeklyAvailability,
      exceptions,
      providerBusy,
      slotMinutes,
      defaultTimezone: calendarTimezone
    });

    const viewModel = {
      ...baseViewModel,
      freeSlots,
      calendarConnected: !!provider,
      calendarTimezone
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
    const { start, end, title, attendeeEmail, description, timeZone, customerName, customerPhone, leadId, postBookingNote } = req.body || {};

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

    if (viewModel.success) {
      try {
        const app = await App.findById(appId).select('owner name twilioPhoneNumber whatsappNumber').lean().exec();
        const owner = app?.owner
          ? await User.findById(app.owner).select('email firstName lastName phoneNumber').lean().exec()
          : null;
        const integration = await Integration.findOne({ owner: appId })
          .select('assistantName companyName primaryColor chatbotImage googleCalendarTimezone')
          .lean()
          .exec();
        const emailService = new EmailService();
        const logoUrl = integration?.chatbotImage?.filename
          ? `${process.env.NEXT_PUBLIC_API_URL || ''}/api/v1/integration/public/apps/${appId}/chatbot-image`
          : '';
        // companyName is the real business brand (e.g. "Facelism"); assistantName is the bot persona (e.g. "Assistant")
        const resolvedCompanyName = integration?.companyName || app?.name || 'Business';
        const businessData = {
          appId,
          companyName: resolvedCompanyName,
          name: resolvedCompanyName,
          email: 'socialaliafzal@gmail.com',
          // Prefer owner's user phone; fallback to app-level numbers.
          phone: owner?.phoneNumber || app?.twilioPhoneNumber || app?.whatsappNumber || '',
          primaryColor: integration?.primaryColor || '#c01721',
          logoUrl,
        };
        const calTz = integration?.googleCalendarTimezone || 'UTC';
        const formatInCalTz = (isoStr) => {
          try {
            return new Date(isoStr).toLocaleString('en-US', {
              timeZone: calTz,
              weekday: 'short',
              year: 'numeric',
              month: 'short',
              day: 'numeric',
              hour: 'numeric',
              minute: '2-digit',
              hour12: true,
            });
          } catch {
            return new Date(isoStr).toLocaleString();
          }
        };
        const appointmentData = {
          serviceName: title,
          title,
          startText: formatInCalTz(start),
          endText: formatInCalTz(end),
          link: viewModel.link || '',
          postBookingNote: postBookingNote || ''
        };
        const resolvedCustomerName = customerName || 'Customer';
        const resolvedCustomerPhone = customerPhone || 'Not provided';
        let confirmationEmailSent = false;
        if (attendeeEmail) {
          await emailService.sendAppointmentConfirmationEmail(
            { name: resolvedCustomerName, email: attendeeEmail },
            appointmentData,
            businessData
          );
          confirmationEmailSent = true;
        }
        if (businessData.email) {
          await emailService.sendAppointmentBusinessNotificationEmail(
            businessData,
            { name: resolvedCustomerName, email: attendeeEmail || 'Not provided', phone: resolvedCustomerPhone },
            appointmentData
          );
        }

        // If customer confirmation email was sent successfully, mark the initiating lead as confirmed.
        if (confirmationEmailSent) {
          try {
            const patch = {
              status: 'confirmed',
              appointmentDetails: {
                eventId: viewModel.eventId || null,
                start: start ? new Date(start) : null,
                end: end ? new Date(end) : null,
                link: viewModel.link || '',
                confirmed: true
              }
            };

            // Preferred: leadId provided by AI/widget.
            let lead = null;
            if (leadId) {
              lead = await Lead.findById(leadId);
            }

            // Fallback: try to resolve lead by app + email/phone within recent window.
            if (!lead) {
              const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
              const or = [];
              if (attendeeEmail) or.push({ leadEmail: String(attendeeEmail).toLowerCase() });
              if (customerPhone) or.push({ leadPhoneNumber: String(customerPhone) });
              if (or.length > 0) {
                lead = await Lead.findOne({
                  appId,
                  createdAt: { $gte: cutoff },
                  $or: or
                }).sort({ createdAt: -1 });
              }
            }

            if (lead) {
              Object.assign(lead, patch);
              await lead.save();
            } else {
              logger.warn('Booking confirmation email sent, but no lead was found to confirm', { appId, leadId: leadId || null });
            }
          } catch (leadErr) {
            logger.error('Failed to update lead to confirmed after booking', { appId, leadId: leadId || null, error: leadErr.message });
          }
        }
      } catch (emailErr) {
        logger.error('Calendar booking email sending failed', { appId, error: emailErr.message });
      }
    }

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
