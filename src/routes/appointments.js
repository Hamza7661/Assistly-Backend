const express = require('express');
const { AppError } = require('../utils/errorHandler');
const { authenticateToken, requireUserOrAdmin } = require('../middleware/auth');
const { Appointment, appointmentCreateSchema, appointmentQuerySchema, appointmentUpdateSchema } = require('../models/Appointment');

const router = express.Router();

// Create appointment for current user
router.post('/', authenticateToken, requireUserOrAdmin, async (req, res, next) => {
  try {
    const { error, value } = appointmentCreateSchema.validate(req.body, { abortEarly: false, stripUnknown: true });
    if (error) {
      const messages = error.details.map(d => d.message);
      throw new AppError(`Validation failed: ${messages.join(', ')}`, 400);
    }
    const owner = req.user.id;
    const appt = new Appointment({ owner, ...value });
    await appt.save();
    res.status(201).json({ status: 'success', message: 'Appointment created', data: { appointment: appt } });
  } catch (err) { next(err); }
});

// List my appointments with optional date range
router.get('/user/:id', authenticateToken, requireUserOrAdmin, async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!id) return next(new AppError('User ID is required', 400));
    if (req.user.role !== 'admin' && req.user.id !== id) return next(new AppError('Insufficient permissions', 403));

    const { error, value } = appointmentQuerySchema.validate(req.query, { abortEarly: false, stripUnknown: true });
    if (error) {
      const messages = error.details.map(d => d.message);
      throw new AppError(`Validation failed: ${messages.join(', ')}`, 400);
    }

    const conditions = [ { owner: id } ];
    if (value.from || value.to) {
      const range = {};
      if (value.from) range.$gte = new Date(value.from);
      if (value.to) range.$lte = new Date(value.to);
      conditions.push({ startAt: range });
    }
    if (value.q && String(value.q).trim().length > 0) {
      const needle = String(value.q).trim();
      const rx = new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      conditions.push({ $or: [ { title: rx }, { description: rx } ] });
    }
    const filter = conditions.length > 1 ? { $and: conditions } : conditions[0];

    const page = value.page;
    const limit = value.limit;
    const skip = (page - 1) * limit;

    const sort = {};
    sort[value.sortBy] = value.sortOrder === 'desc' ? -1 : 1;

    const [items, total] = await Promise.all([
      Appointment.find(filter).sort(sort).skip(skip).limit(limit).exec(),
      Appointment.countDocuments(filter)
    ]);

    res.status(200).json({
      status: 'success',
      data: {
        appointments: items,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
          hasNextPage: skip + items.length < total,
          hasPrevPage: page > 1
        }
      }
    });
  } catch (err) { next(err); }
});

module.exports = router;

// Update an appointment (auth; owner or admin)
router.put('/:id', authenticateToken, requireUserOrAdmin, async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!id) return next(new AppError('Appointment ID is required', 400));
    const { error, value } = appointmentUpdateSchema.validate(req.body, { abortEarly: false, stripUnknown: true });
    if (error) {
      const messages = error.details.map(d => d.message);
      throw new AppError(`Validation failed: ${messages.join(', ')}`, 400);
    }

    const appt = await Appointment.findOne({ _id: id });
    if (!appt) return next(new AppError('Appointment not found', 404));
    if (req.user.role !== 'admin' && String(appt.owner) !== req.user.id) return next(new AppError('Insufficient permissions', 403));

    Object.assign(appt, value);
    await appt.save();
    res.status(200).json({ status: 'success', message: 'Appointment updated', data: { appointment: appt } });
  } catch (err) { next(err); }
});

// Delete an appointment (auth; owner or admin)
router.delete('/:id', authenticateToken, requireUserOrAdmin, async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!id) return next(new AppError('Appointment ID is required', 400));

    const appt = await Appointment.findOne({ _id: id });
    if (!appt) return next(new AppError('Appointment not found', 404));
    if (req.user.role !== 'admin' && String(appt.owner) !== req.user.id) return next(new AppError('Insufficient permissions', 403));

    await Appointment.deleteOne({ _id: id });
    res.status(200).json({ status: 'success', message: 'Appointment deleted' });
  } catch (err) { next(err); }
});


