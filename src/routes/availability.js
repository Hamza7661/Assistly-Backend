const express = require('express');
const { AppError } = require('../utils/errorHandler');
const { authenticateToken, requireUserOrAdmin } = require('../middleware/auth');
const { verifyAppOwnership } = require('../middleware/appOwnership');
const { verifySignedThirdPartyForParamUser } = require('../middleware/thirdParty');
const { Availability, availabilityUpsertSchema, availabilityBulkSchema } = require('../models/Availability');

const router = express.Router();

// Upsert availability for app by dayOfWeek - NEW APP-SCOPED ROUTE
router.put('/apps/:appId', authenticateToken, verifyAppOwnership, async (req, res, next) => {
  try {
    const { error, value } = availabilityUpsertSchema.validate(req.body, { abortEarly: false, stripUnknown: true });
    if (error) {
      const messages = error.details.map(d => d.message);
      throw new AppError(`Validation failed: ${messages.join(', ')}`, 400);
    }
    const { dayOfWeek, slots, allDay } = value;
    const appId = req.appId;

    const defaultAllDay = (dayOfWeek !== 0 && dayOfWeek !== 6);
    const effectiveAllDay = (typeof allDay === 'boolean') ? allDay : defaultAllDay;
    const update = {
      $set: { slots, allDay: effectiveAllDay },
      $setOnInsert: { owner: appId, dayOfWeek }
    };
    const doc = await Availability.findOneAndUpdate(
      { owner: appId, dayOfWeek },
      update,
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    res.status(200).json({ status: 'success', message: 'Availability saved', data: { availability: doc } });
  } catch (err) { next(err); }
});

// Get availability for app - NEW APP-SCOPED ROUTE
router.get('/apps/:appId', authenticateToken, verifyAppOwnership, async (req, res, next) => {
  try {
    const appId = req.appId;
    if (!appId) return next(new AppError('App ID is required', 400));

    const existing = await Availability.find({ owner: appId }).sort({ dayOfWeek: 1 }).exec();

    // Ensure 7 days exist by default
    const present = new Set(existing.map(d => d.dayOfWeek));
    const toCreate = [];
    const tz = (existing[0] && existing[0].timezone) || 'UTC';
    for (let d = 0; d <= 6; d++) {
      if (!present.has(d)) {
        const isWeekend = (d === 0) || (d === 6);
        const defaultAllDay = !isWeekend;
        toCreate.push({ owner: appId, dayOfWeek: d, timezone: tz, slots: [], allDay: defaultAllDay });
      }
    }
    if (toCreate.length > 0) {
      await Availability.insertMany(toCreate);
    }

    const items = await Availability.find({ owner: appId }).sort({ dayOfWeek: 1 }).exec();
    const ordered = items.slice().sort((a, b) => {
      const ak = a.dayOfWeek === 0 ? 7 : a.dayOfWeek;
      const bk = b.dayOfWeek === 0 ? 7 : b.dayOfWeek;
      return ak - bk;
    });
    res.status(200).json({ status: 'success', data: { availability: ordered } });
  } catch (err) { next(err); }
});

// Upsert availability for current user by dayOfWeek - LEGACY ROUTE
router.put('/', authenticateToken, requireUserOrAdmin, async (req, res, next) => {
  try {
    const { error, value } = availabilityUpsertSchema.validate(req.body, { abortEarly: false, stripUnknown: true });
    if (error) {
      const messages = error.details.map(d => d.message);
      throw new AppError(`Validation failed: ${messages.join(', ')}`, 400);
    }
    const { dayOfWeek, slots, allDay } = value;
    const owner = req.user.id;

    const defaultAllDay = (dayOfWeek !== 0 && dayOfWeek !== 6);
    const effectiveAllDay = (typeof allDay === 'boolean') ? allDay : defaultAllDay;
    const update = {
      $set: { slots, allDay: effectiveAllDay },
      $setOnInsert: { owner, dayOfWeek }
    };
    const doc = await Availability.findOneAndUpdate(
      { owner, dayOfWeek },
      update,
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    res.status(200).json({ status: 'success', message: 'Availability saved', data: { availability: doc } });
  } catch (err) { next(err); }
});

// Get my availability - LEGACY ROUTE
router.get('/user/:id', authenticateToken, requireUserOrAdmin, async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!id) return next(new AppError('User ID is required', 400));

    // Only owner or admin
    if (req.user.role !== 'admin' && req.user.id !== id) {
      return next(new AppError('Insufficient permissions', 403));
    }

    const existing = await Availability.find({ owner: id }).sort({ dayOfWeek: 1 }).exec();

    // Ensure 7 days exist by default
    const present = new Set(existing.map(d => d.dayOfWeek));
    const toCreate = [];
    const tz = (existing[0] && existing[0].timezone) || 'UTC';
    for (let d = 0; d <= 6; d++) {
      if (!present.has(d)) {
        const isWeekend = (d === 0) || (d === 6);
        const defaultAllDay = !isWeekend;
        toCreate.push({ owner: id, dayOfWeek: d, timezone: tz, slots: [], allDay: defaultAllDay });
      }
    }
    if (toCreate.length > 0) {
      await Availability.insertMany(toCreate);
    }

    const items = await Availability.find({ owner: id }).sort({ dayOfWeek: 1 }).exec();
    const ordered = items.slice().sort((a, b) => {
      const ak = a.dayOfWeek === 0 ? 7 : a.dayOfWeek;
      const bk = b.dayOfWeek === 0 ? 7 : b.dayOfWeek;
      return ak - bk;
    });
    res.status(200).json({ status: 'success', data: { availability: ordered } });
  } catch (err) { next(err); }
});

// Public: get availability for user (HMAC)
router.get('/public/:id', verifySignedThirdPartyForParamUser, async (req, res, next) => {
  try {
    const { id } = req.params;
    const docs = await Availability.find({ owner: id }).sort({ dayOfWeek: 1 }).select('dayOfWeek timezone slots allDay').exec();
    const map = new Map(docs.map(d => [d.dayOfWeek, d]));
    const tz = docs[0]?.timezone || 'UTC';
    const merged = [];
    for (let d = 0; d <= 6; d++) {
      if (map.has(d)) {
        const m = map.get(d);
        merged.push({ dayOfWeek: d, timezone: m.timezone, slots: m.slots, allDay: m.allDay === true });
      } else {
        const isWeekend = (d === 0) || (d === 6);
        const defaultAllDay = !isWeekend;
        merged.push({ dayOfWeek: d, timezone: tz, slots: [], allDay: defaultAllDay });
      }
    }
    merged.sort((a,b)=>{
      const ak = a.dayOfWeek === 0 ? 7 : a.dayOfWeek;
      const bk = b.dayOfWeek === 0 ? 7 : b.dayOfWeek;
      return ak - bk;
    });
    res.status(200).json({ status: 'success', data: { availability: merged } });
  } catch (err) {
    if (err.name === 'CastError') return next(new AppError('Invalid user ID format', 400));
    next(err);
  }
});

module.exports = router;

// Bulk replace all provided days for current user (1–7 entries)
router.put('/bulk', authenticateToken, requireUserOrAdmin, async (req, res, next) => {
  try {
    const { error, value } = availabilityBulkSchema.validate(req.body, { abortEarly: false, stripUnknown: true });
    if (error) {
      const messages = error.details.map(d => d.message);
      throw new AppError(`Validation failed: ${messages.join(', ')}`, 400);
    }
    const owner = req.user.id;
    const { days } = value;

    // Upsert each day
    const ops = days.map(d => {
      const defaultAllDay = (d.dayOfWeek !== 0 && d.dayOfWeek !== 6);
      const effectiveAllDay = (typeof d.allDay === 'boolean') ? d.allDay : defaultAllDay;
      const upd = {
        $set: { slots: d.slots, allDay: effectiveAllDay },
        $setOnInsert: { owner, dayOfWeek: d.dayOfWeek }
      };
      return Availability.findOneAndUpdate(
        { owner, dayOfWeek: d.dayOfWeek },
        upd,
        { new: true, upsert: true, setDefaultsOnInsert: true }
      );
    });
    const results = await Promise.all(ops);
    res.status(200).json({ status: 'success', message: 'Availability updated', data: { count: results.length } });
  } catch (err) { next(err); }
});


