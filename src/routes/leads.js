const express = require('express');
const { AppError } = require('../utils/errorHandler');
const { authenticateToken, requireUserOrAdmin } = require('../middleware/auth');
const { Lead, leadCreateSchema, leadQuerySchema, leadUpdateSchema } = require('../models/Lead');

const router = express.Router();

// Create lead for current user
router.post('/', authenticateToken, requireUserOrAdmin, async (req, res, next) => {
  try {
    const { error, value } = leadCreateSchema.validate(req.body, { abortEarly: false, stripUnknown: true });
    if (error) {
      const messages = error.details.map(d => d.message);
      throw new AppError(`Validation failed: ${messages.join(', ')}`, 400);
    }
    const userId = req.user.id;
    const lead = new Lead({ userId, ...value });
    await lead.save();
    res.status(201).json({ status: 'success', message: 'Lead created', data: { lead } });
  } catch (err) { next(err); }
});

// Get lead by id (auth; owner/admin)
router.get('/:id', authenticateToken, requireUserOrAdmin, async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!id) return next(new AppError('Lead ID is required', 400));
    const lead = await Lead.findById(id);
    if (!lead) return next(new AppError('Lead not found', 404));
    if (req.user.role !== 'admin' && String(lead.userId) !== req.user.id) return next(new AppError('Insufficient permissions', 403));
    res.status(200).json({ status: 'success', data: { lead } });
  } catch (err) { next(err); }
});

// Paginated list by user (auth; owner/admin) with filters
router.get('/user/:userId', authenticateToken, requireUserOrAdmin, async (req, res, next) => {
  try {
    const { userId } = req.params;
    if (!userId) return next(new AppError('User ID is required', 400));
    if (req.user.role !== 'admin' && req.user.id !== userId) return next(new AppError('Insufficient permissions', 403));

    const { error, value } = leadQuerySchema.validate(req.query, { abortEarly: false, stripUnknown: true });
    if (error) {
      const messages = error.details.map(d => d.message);
      throw new AppError(`Validation failed: ${messages.join(', ')}`, 400);
    }

    const conditions = [ { userId } ];
    if (value.leadType) conditions.push({ leadType: value.leadType });
    if (value.serviceType) conditions.push({ serviceType: value.serviceType });
    if (value.q && String(value.q).trim().length > 0) {
      const needle = String(value.q).trim();
      const rx = new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      conditions.push({ $or: [ { title: rx }, { summary: rx }, { description: rx } ] });
    }
    const filter = conditions.length > 1 ? { $and: conditions } : conditions[0];

    const page = Number(value.page);
    const limit = Number(value.limit);
    const skip = (page - 1) * limit;

    const sortField = value.sortBy;
    const sortDir = value.sortOrder === 'asc' ? 1 : -1;

    const [items, total] = await Promise.all([
      Lead.find(filter).sort({ [sortField]: sortDir }).skip(skip).limit(limit).exec(),
      Lead.countDocuments(filter)
    ]);

    res.status(200).json({
      status: 'success',
      data: {
        leads: items,
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

// Update lead (auth; owner/admin)
router.put('/:id', authenticateToken, requireUserOrAdmin, async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!id) return next(new AppError('Lead ID is required', 400));

    const { error, value } = leadUpdateSchema.validate(req.body, { abortEarly: false, stripUnknown: true });
    if (error) {
      const messages = error.details.map(d => d.message);
      throw new AppError(`Validation failed: ${messages.join(', ')}`, 400);
    }

    const lead = await Lead.findById(id);
    if (!lead) return next(new AppError('Lead not found', 404));
    if (req.user.role !== 'admin' && String(lead.userId) !== req.user.id) return next(new AppError('Insufficient permissions', 403));

    Object.assign(lead, value);
    await lead.save();
    res.status(200).json({ status: 'success', message: 'Lead updated', data: { lead } });
  } catch (err) { next(err); }
});

// Delete lead (auth; owner/admin)
router.delete('/:id', authenticateToken, requireUserOrAdmin, async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!id) return next(new AppError('Lead ID is required', 400));
    const lead = await Lead.findById(id);
    if (!lead) return next(new AppError('Lead not found', 404));
    if (req.user.role !== 'admin' && String(lead.userId) !== req.user.id) return next(new AppError('Insufficient permissions', 403));
    await Lead.deleteOne({ _id: id });
    res.status(200).json({ status: 'success', message: 'Lead deleted' });
  } catch (err) { next(err); }
});

module.exports = router;


