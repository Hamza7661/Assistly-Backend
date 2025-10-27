const express = require('express');
const { 
  ChatbotWorkflow, 
  workflowValidationSchema, 
  workflowUpdateValidationSchema,
  workflowReplaceArraySchema 
} = require('../models/ChatbotWorkflow');
const { AppError } = require('../utils/errorHandler');
const { logger } = require('../utils/logger');
const { authenticateToken, requireUserOrAdmin } = require('../middleware/auth');

const router = express.Router();

// Debug route to check if routes are loaded
router.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'Chatbot workflow routes are working' });
});

// Create a new workflow question
router.post('/', authenticateToken, requireUserOrAdmin, async (req, res, next) => {
  try {
    const { error, value } = workflowValidationSchema.validate(req.body, { abortEarly: false, stripUnknown: true });
    if (error) {
      const messages = error.details.map(d => d.message);
      throw new AppError(`Validation failed: ${messages.join(', ')}`, 400);
    }
    
    const ownerId = req.user.id;
    const workflow = new ChatbotWorkflow({ ...value, owner: ownerId });
    await workflow.save();
    
    logger.info('ChatbotWorkflow created', { workflowId: workflow._id, ownerId });
    res.status(201).json({ 
      status: 'success', 
      message: 'Workflow created successfully', 
      data: { workflow } 
    });
  } catch (err) {
    next(err);
  }
});

// Get all workflows for current user
router.get('/', authenticateToken, requireUserOrAdmin, async (req, res, next) => {
  try {
    const { includeInactive } = req.query;
    const filter = { owner: req.user.id };
    if (!includeInactive) filter.isActive = true;
    
    const workflows = await ChatbotWorkflow.find(filter).sort({ order: 1, createdAt: 1 }).exec();
    res.status(200).json({ 
      status: 'success', 
      data: { workflows, count: workflows.length } 
    });
  } catch (err) {
    next(err);
  }
});

// Get single workflow by ID
router.get('/:id', authenticateToken, requireUserOrAdmin, async (req, res, next) => {
  try {
    const workflow = await ChatbotWorkflow.findOne({ _id: req.params.id, owner: req.user.id }).exec();
    if (!workflow) {
      throw new AppError('Workflow not found', 404);
    }
    res.status(200).json({ status: 'success', data: { workflow } });
  } catch (err) {
    if (err.name === 'CastError') return next(new AppError('Invalid workflow ID format', 400));
    next(err);
  }
});

// Update workflow
router.patch('/:id', authenticateToken, requireUserOrAdmin, async (req, res, next) => {
  try {
    const { error, value } = workflowUpdateValidationSchema.validate(req.body, { abortEarly: false, stripUnknown: true });
    if (error) {
      const messages = error.details.map(d => d.message);
      throw new AppError(`Validation failed: ${messages.join(', ')}`, 400);
    }
    
    const workflow = await ChatbotWorkflow.findOneAndUpdate(
      { _id: req.params.id, owner: req.user.id },
      value,
      { new: true, runValidators: true }
    ).exec();
    
    if (!workflow) {
      throw new AppError('Workflow not found', 404);
    }
    
    logger.info('ChatbotWorkflow updated', { workflowId: workflow._id });
    res.status(200).json({ 
      status: 'success', 
      message: 'Workflow updated successfully', 
      data: { workflow } 
    });
  } catch (err) {
    if (err.name === 'CastError') return next(new AppError('Invalid workflow ID format', 400));
    next(err);
  }
});

// Delete workflow
router.delete('/:id', authenticateToken, requireUserOrAdmin, async (req, res, next) => {
  try {
    const workflow = await ChatbotWorkflow.findOneAndDelete({ _id: req.params.id, owner: req.user.id }).exec();
    if (!workflow) {
      throw new AppError('Workflow not found', 404);
    }
    
    logger.info('ChatbotWorkflow deleted', { workflowId: req.params.id });
    res.status(200).json({ 
      status: 'success', 
      message: 'Workflow deleted successfully' 
    });
  } catch (err) {
    if (err.name === 'CastError') return next(new AppError('Invalid workflow ID format', 400));
    next(err);
  }
});

// Replace all workflows (useful for bulk updates)
router.put('/', authenticateToken, requireUserOrAdmin, async (req, res, next) => {
  try {
    const { error, value } = workflowReplaceArraySchema.validate(req.body, { abortEarly: false, stripUnknown: true });
    if (error) {
      const messages = error.details.map(d => d.message);
      throw new AppError(`Validation failed: ${messages.join(', ')}`, 400);
    }
    
    const ownerId = req.user.id;
    const { workflows } = value;
    
    // Delete all existing workflows for this owner
    await ChatbotWorkflow.deleteMany({ owner: ownerId });
    
    // Insert new workflows
    let inserted = [];
    if (Array.isArray(workflows) && workflows.length > 0) {
      inserted = await ChatbotWorkflow.insertMany(
        workflows.map(w => ({ ...w, owner: ownerId }))
      );
    }
    
    logger.info('ChatbotWorkflows replaced', { ownerId, count: inserted.length });
    res.status(200).json({ 
      status: 'success', 
      message: 'Workflows replaced successfully', 
      data: { count: inserted.length, workflows: inserted } 
    });
  } catch (err) {
    next(err);
  }
});

// Public endpoint to get workflows (for chatbot context)
router.get('/public/:ownerId', async (req, res, next) => {
  try {
    const { ownerId } = req.params;
    const filter = { owner: ownerId, isActive: true };
    
    const workflows = await ChatbotWorkflow.find(filter)
      .select('title question questionType options isRoot order')
      .sort({ order: 1, createdAt: 1 })
      .exec();
    
    res.status(200).json({ 
      status: 'success', 
      data: { workflows, count: workflows.length } 
    });
  } catch (err) {
    if (err.name === 'CastError') return next(new AppError('Invalid owner ID format', 400));
    next(err);
  }
});

module.exports = router;
