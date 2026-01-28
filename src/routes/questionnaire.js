const express = require('express');
const { Questionnaire, questionnaireValidationSchema, questionnaireUpdateValidationSchema, questionnaireArraySchema, QUESTIONNAIRE_TYPES } = require('../models/Questionnaire');
const { AppError } = require('../utils/errorHandler');
const { logger } = require('../utils/logger');
const { authenticateToken, requireUserOrAdmin } = require('../middleware/auth');
const { verifyAppOwnership } = require('../middleware/appOwnership');

const router = express.Router();

// Create/Update (replace) list for app by type (array based) - NEW APP-SCOPED ROUTE
router.put('/apps/:appId', authenticateToken, verifyAppOwnership, async (req, res, next) => {
  try {
    const { error, value } = questionnaireArraySchema.validate(req.body, { abortEarly: false, stripUnknown: true });
    if (error) {
      const messages = error.details.map(d => d.message);
      throw new AppError(`Validation failed: ${messages.join(', ')}`, 400);
    }
    const { type, items } = value;
    const appId = req.appId;
    await Questionnaire.deleteMany({ owner: appId, type });
    let inserted = [];
    if (Array.isArray(items) && items.length > 0) {
      inserted = await Questionnaire.insertMany(items.map(i => ({
        owner: appId,
        type,
        question: i.question,
        answer: i.answer,
        attachedWorkflows: (i.attachedWorkflows || []).map(aw => ({
          workflowId: aw.workflowId || null,
          order: aw.order || 0
        })),
        isActive: true
      })));
    }
    logger.info('Questionnaire list replaced (app)', { appId, type, count: inserted.length });
    res.status(200).json({ status: 'success', message: 'Questionnaire updated', data: { count: inserted.length } });
  } catch (err) { next(err); }
});

// List Q&A for app (optionally by type) - NEW APP-SCOPED ROUTE
router.get('/apps/:appId', authenticateToken, verifyAppOwnership, async (req, res, next) => {
  try {
    const { type, includeInactive } = req.query;
    const appId = req.appId;
    const filter = { owner: appId };
    if (type) filter.type = parseInt(type);
    if (!includeInactive) filter.isActive = true;
    const items = await Questionnaire.find(filter).populate('attachedWorkflows.workflowId', '_id title question questionTypeId isRoot isActive order').sort({ updatedAt: -1 }).exec();
    res.status(200).json({ status: 'success', data: { faqs: items, count: items.length } });
  } catch (err) { next(err); }
});

// Replace entire list for a user and type (LEGACY - kept for backward compatibility)
router.put('/user/:ownerId', authenticateToken, requireUserOrAdmin, async (req, res, next) => {
  try {
    const { ownerId } = req.params;
    if (req.user.role !== 'admin' && req.user.id !== ownerId) {
      throw new AppError('Insufficient permissions', 403);
    }
    const { error, value } = questionnaireArraySchema.validate(req.body, { abortEarly: false, stripUnknown: true });
    if (error) {
      const messages = error.details.map(d => d.message);
      throw new AppError(`Validation failed: ${messages.join(', ')}`, 400);
    }
    const { type, items } = value;
    await Questionnaire.deleteMany({ owner: ownerId, type });
    let inserted = [];
    if (Array.isArray(items) && items.length > 0) {
      inserted = await Questionnaire.insertMany(items.map(i => ({
        owner: ownerId,
        type,
        question: i.question,
        answer: i.answer,
        attachedWorkflows: (i.attachedWorkflows || []).map(aw => ({
          workflowId: aw.workflowId || null,
          order: aw.order || 0
        })),
        isActive: true
      })));
    }
    logger.info('Questionnaire list replaced', { ownerId, type, count: inserted.length });
    res.status(200).json({ status: 'success', message: 'Questionnaire updated', data: { count: inserted.length } });
  } catch (err) { if (err.name === 'CastError') return next(new AppError('Invalid owner ID format', 400)); next(err); }
});

// Public fetch by app and type (returns [{question, answer}]) - NEW APP-SCOPED ROUTE
router.get('/public/apps/:appId/:type', async (req, res, next) => {
  try {
    const { appId, type } = req.params;
    const filter = { owner: appId, type: parseInt(type), isActive: true };
    const docs = await Questionnaire.find(filter).sort({ updatedAt: -1 }).select('question answer').exec();
    const items = docs.map(d => ({ question: d.question, answer: d.answer }));
    res.status(200).json({ status: 'success', data: { items, count: items.length } });
  } catch (err) { if (err.name === 'CastError') return next(new AppError('Invalid app ID format', 400)); next(err); }
});

// Public fetch by owner and type (LEGACY - kept for backward compatibility)
router.get('/public/:ownerId/:type', async (req, res, next) => {
  try {
    const { ownerId, type } = req.params;
    const filter = { owner: ownerId, type: parseInt(type), isActive: true };
    const docs = await Questionnaire.find(filter).sort({ updatedAt: -1 }).select('question answer').exec();
    const items = docs.map(d => ({ question: d.question, answer: d.answer }));
    res.status(200).json({ status: 'success', data: { items, count: items.length } });
  } catch (err) { if (err.name === 'CastError') return next(new AppError('Invalid owner ID format', 400)); next(err); }
});

module.exports = router;


