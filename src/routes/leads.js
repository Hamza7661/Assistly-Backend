const express = require('express');
const { AppError } = require('../utils/errorHandler');
const { authenticateToken, requireUserOrAdmin } = require('../middleware/auth');
const { verifySignedThirdPartyForParamUser } = require('../middleware/thirdParty');
const { verifyAppOwnership } = require('../middleware/appOwnership');
const { App } = require('../models/App');
const { Lead, leadCreateSchema, leadQuerySchema, leadUpdateSchema } = require('../models/Lead');
const { LeadReadState } = require('../models/LeadReadState');
const websocketServer = require('../utils/websocketServer');

const router = express.Router();

function getClientIp(req) {
  const xfwd = req.headers['x-forwarded-for'];
  if (typeof xfwd === 'string' && xfwd.trim()) {
    // May be a comma-separated list; take the first hop.
    return xfwd.split(',')[0].trim();
  }
  return req.ip || req.connection?.remoteAddress || req.socket?.remoteAddress || null;
}

function buildClientContextFromReq(req) {
  const ipAddress = getClientIp(req);
  const userAgent = req.get('user-agent') || null;
  return { ipAddress, userAgent };
}

function mergeClientContext(existing, incoming) {
  const out = { ...(existing || {}) };
  if (incoming?.ipAddress && !out.ipAddress) out.ipAddress = incoming.ipAddress;
  if (incoming?.userAgent && !out.userAgent) out.userAgent = incoming.userAgent;
  return out;
}

/** Voice leads are created via signed server-to-server calls; req IP is the AI service, not the caller. */
function mergePublicLeadClientContext(value, ctxFromReq) {
  if (value.sourceChannel === 'voice') {
    const vc = value.clientContext || {};
    return {
      browserName: vc.browserName ?? null,
      browserVersion: vc.browserVersion ?? null,
      osName: vc.osName ?? null,
      deviceType: vc.deviceType || 'voice',
      userAgent: vc.userAgent || null,
      ipAddress: vc.ipAddress != null ? vc.ipAddress : null
    };
  }
  return mergeClientContext(value.clientContext || {}, ctxFromReq);
}

function buildLeadBroadcastPayload(lead) {
  return {
    _id: lead._id,
    appId: lead.appId,
    title: lead.title,
    leadName: lead.leadName,
    leadEmail: lead.leadEmail,
    leadPhoneNumber: lead.leadPhoneNumber,
    leadType: lead.leadType,
    serviceType: lead.serviceType,
    sourceChannel: lead.sourceChannel,
    status: lead.status,
    location: lead.location,
    clientContext: lead.clientContext,
    initialInteraction: lead.initialInteraction,
    clickedItems: lead.clickedItems,
    appointmentDetails: lead.appointmentDetails,
    userFeedback: lead.userFeedback,
    leadTypeSwitchHistory: lead.leadTypeSwitchHistory,
    summary: lead.summary,
    description: lead.description,
    history: lead.history,
    leadDateTime: lead.leadDateTime,
    createdAt: lead.createdAt,
    updatedAt: lead.updatedAt
  };
}

/** Resolve if current user may access this lead (for routes that don't have req.appId, e.g. GET/PUT/DELETE /:id) */
async function canAccessLead(lead, userId, userRole, reqAppId) {
  if (userRole === 'admin') return true;
  if (reqAppId && lead.appId && String(lead.appId) === reqAppId) return true;
  if (lead.userId && String(lead.userId) === userId) return true;
  if (lead.appId) {
    const app = await App.findById(lead.appId).select('owner').lean();
    if (app && app.owner && String(app.owner) === userId) return true;
  }
  return false;
}

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
    const ctx = buildClientContextFromReq(req);
    const lead = new Lead({ appId, ...value, clientContext: mergeClientContext(value.clientContext, ctx) });
    await lead.save();
    
    // Broadcast new lead to user via WebSocket
    websocketServer.broadcastToUser(userId, {
      lead: buildLeadBroadcastPayload(lead)
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
    const ctx = buildClientContextFromReq(req);
    const leadData = appId ? { appId, ...value } : { userId, ...value };
    leadData.clientContext = mergeClientContext(value.clientContext, ctx);
    const lead = new Lead(leadData);
    await lead.save();
    
    // Broadcast new lead to user via WebSocket
    websocketServer.broadcastToUser(userId, {
      lead: buildLeadBroadcastPayload(lead)
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
    const allowed = await canAccessLead(lead, req.user.id, req.user.role, req.appId);
    if (!allowed) return next(new AppError('Insufficient permissions', 403));
    res.status(200).json({ status: 'success', data: { lead } });
  } catch (err) { next(err); }
});

// Get read-state map for specific leads in an app (cross-device sync)
router.get('/apps/:appId/read-state', authenticateToken, verifyAppOwnership, async (req, res, next) => {
  try {
    const appId = req.appId;
    const rawLeadIds = String(req.query.leadIds || '')
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean);

    if (rawLeadIds.length === 0) {
      return res.status(200).json({ status: 'success', data: { reads: {} } });
    }

    const leadIds = Array.from(new Set(rawLeadIds)).slice(0, 500);
    const reads = await LeadReadState.find({
      appId,
      userId: req.user.id,
      leadId: { $in: leadIds },
    }).select('leadId readAt').lean();

    const readMap = {};
    reads.forEach((row) => {
      if (!row?.leadId) return;
      readMap[String(row.leadId)] = row.readAt;
    });

    res.status(200).json({ status: 'success', data: { reads: readMap } });
  } catch (err) { next(err); }
});

// Mark one or many leads as read in an app (cross-device sync)
router.post('/apps/:appId/read-state/mark', authenticateToken, verifyAppOwnership, async (req, res, next) => {
  try {
    const appId = req.appId;
    const rawLeadIds = Array.isArray(req.body?.leadIds) ? req.body.leadIds : [];
    const leadIds = Array.from(new Set(
      rawLeadIds
        .map((v) => String(v || '').trim())
        .filter(Boolean)
    )).slice(0, 500);

    if (leadIds.length === 0) {
      return res.status(200).json({ status: 'success', data: { updated: 0 } });
    }

    const now = new Date();
    const ops = leadIds.map((leadId) => ({
      updateOne: {
        filter: { appId, userId: req.user.id, leadId },
        update: {
          $set: { readAt: now },
          $setOnInsert: { appId, userId: req.user.id, leadId },
        },
        upsert: true,
      },
    }));

    const result = await LeadReadState.bulkWrite(ops, { ordered: false });
    const updated = (result.modifiedCount || 0) + (result.upsertedCount || 0);

    res.status(200).json({ status: 'success', data: { updated } });
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
    if (value.sourceChannel) conditions.push({ sourceChannel: value.sourceChannel });
    if (value.status) conditions.push({ status: value.status });
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
    if (value.sourceChannel) conditions.push({ sourceChannel: value.sourceChannel });
    if (value.status) conditions.push({ status: value.status });
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
    const allowed = await canAccessLead(lead, req.user.id, req.user.role, req.appId);
    if (!allowed) return next(new AppError('Insufficient permissions', 403));

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
    const allowed = await canAccessLead(lead, req.user.id, req.user.role, req.appId);
    if (!allowed) return next(new AppError('Insufficient permissions', 403));
    await Lead.deleteOne({ _id: id });
    res.status(200).json({ status: 'success', message: 'Lead deleted' });
  } catch (err) { next(err); }
});

// HMAC public create for a specific user (no JWT)
router.post('/public/:userId', verifySignedThirdPartyForParamUser, async (req, res, next) => {
  try {
    const { userId } = req.params;
    const { error, value } = leadCreateSchema.validate(req.body, { abortEarly: false, stripUnknown: true });
    if (error) {
      const messages = error.details.map(d => d.message);
      throw new AppError(`Validation failed: ${messages.join(', ')}`, 400);
    }
    const ctx = buildClientContextFromReq(req);
    // Configurable dedupe window (hours): request override > env > default(4).
    const requestWindow = Number(req.body?.dedupeWindowHours);
    const envWindow = Number(process.env.LEAD_DEDUPE_WINDOW_HOURS);
    const dedupeWindowHours = Number.isFinite(requestWindow) && requestWindow > 0
      ? requestWindow
      : (Number.isFinite(envWindow) && envWindow > 0 ? envWindow : 4);
    const dedupeCutoff = new Date(Date.now() - dedupeWindowHours * 60 * 60 * 1000);

    // Reuse most recent open lead inside window instead of creating duplicates.
    // Scope includes app/source when available to avoid cross-channel collisions.
    const reuseFilter = {
      userId,
      status: { $in: ['interacting', 'in_progress'] },
      createdAt: { $gte: dedupeCutoff }
    };
    if (value.appId) reuseFilter.appId = value.appId;
    if (value.sourceChannel) reuseFilter.sourceChannel = value.sourceChannel;

    const existingOpenLead = await Lead.findOne(reuseFilter).sort({ createdAt: -1 });
    if (existingOpenLead) {
      const mergeData = { ...value };
      // Prevent accidental data loss when create payload contains empty defaults.
      if (Array.isArray(mergeData.clickedItems) && mergeData.clickedItems.length === 0) delete mergeData.clickedItems;
      if (!mergeData.initialInteraction) delete mergeData.initialInteraction;
      if (existingOpenLead.status === 'in_progress' && mergeData.status === 'interacting') delete mergeData.status;
      mergeData.clientContext = mergeClientContext(
        existingOpenLead.clientContext,
        mergePublicLeadClientContext(value, ctx)
      );
      Object.assign(existingOpenLead, mergeData);
      await existingOpenLead.save();
      websocketServer.broadcastToUser(userId, { lead: buildLeadBroadcastPayload(existingOpenLead) });
      return res.status(200).json({ status: 'success', message: 'Lead reused', data: { lead: existingOpenLead } });
    }

    // Accept appId from body for app-scoped leads (from widget).
    const leadData = { userId, ...value, clientContext: mergePublicLeadClientContext(value, ctx) };
    const lead = new Lead(leadData);
    await lead.save();
    
    // Broadcast new lead to user via WebSocket
    websocketServer.broadcastToUser(userId, {
      lead: buildLeadBroadcastPayload(lead)
    });
    
    res.status(201).json({ status: 'success', message: 'Lead created', data: { lead } });
  } catch (err) { next(err); }
});

// HMAC public partial update (no JWT)
router.patch('/public/:userId/:leadId', verifySignedThirdPartyForParamUser, async (req, res, next) => {
  try {
    const { userId, leadId } = req.params;
    if (!leadId) return next(new AppError('Lead ID is required', 400));
    const { error, value } = leadUpdateSchema.validate(req.body, { abortEarly: false, stripUnknown: true });
    if (error) {
      const messages = error.details.map(d => d.message);
      throw new AppError(`Validation failed: ${messages.join(', ')}`, 400);
    }
    const lead = await Lead.findById(leadId);
    if (!lead) return next(new AppError('Lead not found', 404));
    Object.assign(lead, value);
    await lead.save();
    websocketServer.broadcastToUser(userId, { lead: buildLeadBroadcastPayload(lead) });
    res.status(200).json({ status: 'success', message: 'Lead updated', data: { lead } });
  } catch (err) { next(err); }
});

module.exports = router;


