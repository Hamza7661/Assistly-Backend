const express = require('express');
const { AppError } = require('../utils/errorHandler');
const { authenticateToken, requireUserOrAdmin } = require('../middleware/auth');
const { verifySignedThirdPartyForParamUser } = require('../middleware/thirdParty');
const { verifyAppOwnership } = require('../middleware/appOwnership');
const { Lead, leadCreateSchema, leadQuerySchema, leadUpdateSchema } = require('../models/Lead');
const websocketServer = require('../utils/websocketServer');

const router = express.Router();

// Create lead for app - NEW APP-SCOPED ROUTE
router.post('/apps/:appId', authenticateToken, verifyAppOwnership, async (req, res, next) => {
  try {
    const { error, value } = leadCreateSchema.validate(req.body, { abortEarly: false, stripUnknown: true });
    if (error) {
      const messages = error.details.map(d => d.message);
      throw new AppError(`Validation failed: ${messages.join(', ')}`, 400);
    }
    const appId = req.appId;
    const userId = req.user.id;
    const lead = new Lead({ appId, ...value });
    await lead.save();
    
    // Broadcast new lead to user via WebSocket
    websocketServer.broadcastToUser(userId, {
      lead: {
        _id: lead._id,
        title: lead.title,
        leadName: lead.leadName,
        leadEmail: lead.leadEmail,
        leadPhoneNumber: lead.leadPhoneNumber,
        leadType: lead.leadType,
        serviceType: lead.serviceType,
        summary: lead.summary,
        description: lead.description,
        history: lead.history,
        leadDateTime: lead.leadDateTime,
        createdAt: lead.createdAt,
        updatedAt: lead.updatedAt
      }
    });
    
    res.status(201).json({ status: 'success', message: 'Lead created', data: { lead } });
  } catch (err) { next(err); }
});

// Create lead for current user - LEGACY ROUTE
router.post('/', authenticateToken, requireUserOrAdmin, async (req, res, next) => {
  try {
    const { error, value } = leadCreateSchema.validate(req.body, { abortEarly: false, stripUnknown: true });
    if (error) {
      const messages = error.details.map(d => d.message);
      throw new AppError(`Validation failed: ${messages.join(', ')}`, 400);
    }
    const userId = req.user.id;
    // For app-scoped routes, use appId; for legacy routes, use userId
    const appId = req.appId || null;
    const leadData = appId ? { appId, ...value } : { userId, ...value };
    const lead = new Lead(leadData);
    await lead.save();
    
    // Broadcast new lead to user via WebSocket
    websocketServer.broadcastToUser(userId, {
      lead: {
        _id: lead._id,
        title: lead.title,
        leadName: lead.leadName,
        leadEmail: lead.leadEmail,
        leadPhoneNumber: lead.leadPhoneNumber,
        leadType: lead.leadType,
        serviceType: lead.serviceType,
        summary: lead.summary,
        description: lead.description,
        history: lead.history,
        leadDateTime: lead.leadDateTime,
        createdAt: lead.createdAt,
        updatedAt: lead.updatedAt
      }
    });
    
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
    // Check ownership via appId or userId
    const isOwner = req.user.role === 'admin' || 
      (lead.appId && String(lead.appId) === req.appId) ||
      (lead.userId && String(lead.userId) === req.user.id);
    if (!isOwner) return next(new AppError('Insufficient permissions', 403));
    res.status(200).json({ status: 'success', data: { lead } });
  } catch (err) { next(err); }
});

// Paginated list by app (auth; owner/admin) with filters - NEW APP-SCOPED ROUTE
router.get('/apps/:appId', authenticateToken, verifyAppOwnership, async (req, res, next) => {
  try {
    const appId = req.appId;
    if (!appId) return next(new AppError('App ID is required', 400));

    const { error, value } = leadQuerySchema.validate(req.query, { abortEarly: false, stripUnknown: true });
    if (error) {
      const messages = error.details.map(d => d.message);
      throw new AppError(`Validation failed: ${messages.join(', ')}`, 400);
    }

    const conditions = [ { appId } ];
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

// Paginated list by user (auth; owner/admin) with filters - LEGACY ROUTE
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
    // Check ownership via appId or userId
    const isOwner = req.user.role === 'admin' || 
      (lead.appId && String(lead.appId) === req.appId) ||
      (lead.userId && String(lead.userId) === req.user.id);
    if (!isOwner) return next(new AppError('Insufficient permissions', 403));

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
    // Check ownership via appId or userId
    const isOwner = req.user.role === 'admin' || 
      (lead.appId && String(lead.appId) === req.appId) ||
      (lead.userId && String(lead.userId) === req.user.id);
    if (!isOwner) return next(new AppError('Insufficient permissions', 403));
    await Lead.deleteOne({ _id: id });
    res.status(200).json({ status: 'success', message: 'Lead deleted' });
  } catch (err) { next(err); }
});

module.exports = router;
 
// HMAC public create for a specific user (no JWT)
router.post('/public/:userId', verifySignedThirdPartyForParamUser, async (req, res, next) => {
  try {
    const { userId } = req.params;
    const { error, value } = leadCreateSchema.validate(req.body, { abortEarly: false, stripUnknown: true });
    if (error) {
      const messages = error.details.map(d => d.message);
      throw new AppError(`Validation failed: ${messages.join(', ')}`, 400);
    }
    const lead = new Lead({ userId, ...value });
    await lead.save();
    
    // Broadcast new lead to user via WebSocket
    websocketServer.broadcastToUser(userId, {
      lead: {
        _id: lead._id,
        title: lead.title,
        leadName: lead.leadName,
        leadEmail: lead.leadEmail,
        leadPhoneNumber: lead.leadPhoneNumber,
        leadType: lead.leadType,
        serviceType: lead.serviceType,
        summary: lead.summary,
        description: lead.description,
        history: lead.history,
        leadDateTime: lead.leadDateTime,
        createdAt: lead.createdAt,
        updatedAt: lead.updatedAt
      }
    });
    
    res.status(201).json({ status: 'success', message: 'Lead created', data: { lead } });
  } catch (err) { next(err); }
});


