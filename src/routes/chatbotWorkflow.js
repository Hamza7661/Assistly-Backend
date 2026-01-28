const express = require('express');
const mongoose = require('mongoose');
const { 
  ChatbotWorkflow, 
  workflowValidationSchema, 
  workflowUpdateValidationSchema,
  workflowReplaceArraySchema 
} = require('../models/ChatbotWorkflow');
const { QuestionType } = require('../models/QuestionType');
const { AppError } = require('../utils/errorHandler');
const { logger } = require('../utils/logger');
const { authenticateToken, requireUserOrAdmin } = require('../middleware/auth');
const { verifyAppOwnership } = require('../middleware/appOwnership');

const router = express.Router();

// Debug route to check if routes are loaded
router.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'Chatbot workflow routes are working' });
});

// Helper function to validate questionType ID exists
async function validateQuestionTypeId(questionTypeId) {
  if (!questionTypeId) {
    return 1; // Default to TEXT_RESPONSE (id: 1)
  }
  
  const questionType = await QuestionType.findOne({ id: questionTypeId, isActive: true });
  if (!questionType) {
    throw new AppError(`Invalid questionType ID: ${questionTypeId}`, 400);
  }
  return questionTypeId;
}

// Create a new workflow question for app - NEW APP-SCOPED ROUTE
router.post('/apps/:appId', authenticateToken, verifyAppOwnership, async (req, res, next) => {
  try {
    const { error, value } = workflowValidationSchema.validate(req.body, { abortEarly: false, stripUnknown: true });
    if (error) {
      const messages = error.details.map(d => d.message);
      throw new AppError(`Validation failed: ${messages.join(', ')}`, 400);
    }
    
    // Validate questionTypeId exists in database
    const questionTypeId = await validateQuestionTypeId(value.questionTypeId);
    
    const appId = req.appId;
    let workflowData = { ...value, owner: appId, questionTypeId: questionTypeId };
    
    // If this is a root question (new workflow group), workflowGroupId should be null
    // After creation, we'll set it to its own ID
    if (value.isRoot) {
      workflowData.workflowGroupId = null;
    }
    
    const workflow = new ChatbotWorkflow(workflowData);
    await workflow.save();
    
    // If this is a root question, set its workflowGroupId to itself
    if (value.isRoot && !workflow.workflowGroupId) {
      workflow.workflowGroupId = workflow._id;
      await workflow.save();
    }
    
    logger.info('ChatbotWorkflow created', { workflowId: workflow._id, appId });
    res.status(201).json({ 
      status: 'success', 
      message: 'Workflow created successfully', 
      data: { workflow } 
    });
  } catch (err) {
    next(err);
  }
});

// Create a new workflow question - LEGACY ROUTE
router.post('/', authenticateToken, requireUserOrAdmin, async (req, res, next) => {
  try {
    const { error, value } = workflowValidationSchema.validate(req.body, { abortEarly: false, stripUnknown: true });
    if (error) {
      const messages = error.details.map(d => d.message);
      throw new AppError(`Validation failed: ${messages.join(', ')}`, 400);
    }
    
    // Validate questionTypeId exists in database
    const questionTypeId = await validateQuestionTypeId(value.questionTypeId);
    
    const ownerId = req.user.id;
    let workflowData = { ...value, owner: ownerId, questionTypeId: questionTypeId };
    
    // If this is a root question (new workflow group), workflowGroupId should be null
    // After creation, we'll set it to its own ID
    if (value.isRoot) {
      workflowData.workflowGroupId = null;
    }
    
    const workflow = new ChatbotWorkflow(workflowData);
    await workflow.save();
    
    // If this is a root question, set its workflowGroupId to itself
    if (value.isRoot && !workflow.workflowGroupId) {
      workflow.workflowGroupId = workflow._id;
      await workflow.save();
    }
    
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

// Get all workflows for app - NEW APP-SCOPED ROUTE
router.get('/apps/:appId', authenticateToken, verifyAppOwnership, async (req, res, next) => {
  try {
    const { includeInactive } = req.query;
    const appId = req.appId;
    
    const filter = { owner: appId };
    if (!includeInactive) filter.isActive = true;
    
    const workflows = await ChatbotWorkflow.find(filter).sort({ order: 1, createdAt: 1 }).exec();
    res.status(200).json({ 
      status: 'success', 
      data: { workflows, count: workflows.length } 
    });
  } catch (err) {
    if (err.name === 'CastError') {
      return next(new AppError('Invalid workflow ID format', 400));
    }
    next(err);
  }
});

// Get all workflows for current user - LEGACY ROUTE
router.get('/', authenticateToken, requireUserOrAdmin, async (req, res, next) => {
  try {
    const { includeInactive } = req.query;
    
    // Validate user ID
    if (!req.user || !req.user.id) {
      throw new AppError('User ID is required', 400);
    }
    
    const filter = { owner: req.user.id };
    if (!includeInactive) filter.isActive = true;
    
    const workflows = await ChatbotWorkflow.find(filter).sort({ order: 1, createdAt: 1 }).exec();
    res.status(200).json({ 
      status: 'success', 
      data: { workflows, count: workflows.length } 
    });
  } catch (err) {
    if (err.name === 'CastError') {
      return next(new AppError('Invalid workflow ID format', 400));
    }
    next(err);
  }
});

// Get workflows grouped by workflow group for app - NEW APP-SCOPED ROUTE
router.get('/apps/:appId/grouped', authenticateToken, verifyAppOwnership, async (req, res, next) => {
  try {
    const { includeInactive } = req.query;
    const appId = req.appId;
    
    if (!appId) {
      throw new AppError('App ID is required', 400);
    }
    
    // Validate appId is a valid ObjectId format
    if (!mongoose.Types.ObjectId.isValid(appId)) {
      throw new AppError('Invalid app ID format', 400);
    }
    
    const filter = { owner: appId };
    if (!includeInactive) filter.isActive = true;
    
    let allWorkflows;
    try {
      allWorkflows = await ChatbotWorkflow.find(filter).sort({ order: 1, createdAt: 1 }).exec();
    } catch (findErr) {
      if (findErr.name === 'CastError') {
        logger.error('CastError in ChatbotWorkflow.find', { 
          filter, 
          error: findErr.message,
          user: req.user 
        });
        throw new AppError('Invalid workflow ID format in query', 400);
      }
      throw findErr;
    }
    
    // Group workflows by workflowGroupId
    const grouped = {};
    const rootWorkflows = [];
    
    allWorkflows.forEach(workflow => {
      try {
        // Skip workflows without valid IDs
        if (!workflow._id) {
          logger.warn('Skipping workflow without _id', { workflow });
          return;
        }

        const workflowId = workflow._id.toString();
        
        // Determine if this is a root workflow
        // A workflow is root if: it's marked as root OR it has no valid workflowGroupId (legacy)
        const hasValidGroupId = workflow.workflowGroupId && 
                                workflow.workflowGroupId.toString && 
                                typeof workflow.workflowGroupId.toString === 'function';
        
        const isRoot = workflow.isRoot || (!hasValidGroupId);
        
        let groupId;
        if (isRoot) {
          groupId = workflowId;
        } else {
          try {
            // Safely convert workflowGroupId to string
            groupId = hasValidGroupId ? workflow.workflowGroupId.toString() : workflowId;
          } catch (idErr) {
            // If conversion fails, treat as root workflow
            logger.warn('Invalid workflowGroupId, treating as root', { 
              workflowId, 
              workflowGroupId: workflow.workflowGroupId 
            });
            groupId = workflowId;
          }
        }
        
        if (isRoot || groupId === workflowId) {
          // This is a root workflow (workflow group)
          if (!grouped[groupId]) {
            grouped[groupId] = {
              _id: workflowId,
              title: workflow.title,
              isActive: workflow.isActive,
              questions: []
            };
            rootWorkflows.push(grouped[groupId]);
          }
          grouped[groupId].rootQuestion = workflow;
          
          // If workflowGroupId is not set or invalid, update it (for backward compatibility)
          // Do this asynchronously to avoid blocking the response
          if ((!workflow.workflowGroupId || !hasValidGroupId) && workflow._id) {
            // Validate the ID before attempting update
            if (mongoose.Types.ObjectId.isValid(workflow._id)) {
              ChatbotWorkflow.findByIdAndUpdate(
                workflow._id,
                { workflowGroupId: workflow._id },
                { new: true }
              ).catch(err => logger.error('Failed to update workflowGroupId', { 
                workflowId: workflow._id, 
                error: err.message || err 
              }));
            } else {
              logger.warn('Skipping workflowGroupId update - invalid workflow ID', { 
                workflowId: workflow._id 
              });
            }
          }
        } else {
          // This is a question within a workflow
          if (!grouped[groupId]) {
            // Find the root question for this group
            const rootQuestion = allWorkflows.find(w => {
              if (!w._id) return false;
              try {
                const wId = w._id.toString();
                const wGroupId = (w.workflowGroupId && w.workflowGroupId.toString) 
                  ? w.workflowGroupId.toString() 
                  : null;
                return (wId === groupId && w.isRoot) || (wGroupId === groupId && w.isRoot);
              } catch {
                return false;
              }
            });
            
            grouped[groupId] = {
              _id: groupId,
              title: rootQuestion?.title || 'Unnamed Workflow',
              isActive: rootQuestion?.isActive ?? true,
              questions: []
            };
            if (rootQuestion) {
              grouped[groupId].rootQuestion = rootQuestion;
              // Only add to rootWorkflows if not already added
              if (!rootWorkflows.find(r => r._id === groupId)) {
                rootWorkflows.push(grouped[groupId]);
              }
            }
          }
          grouped[groupId].questions.push(workflow);
        }
      } catch (workflowErr) {
        // Skip invalid workflows and log the error
        logger.error('Error processing workflow in grouped endpoint', { 
          workflowId: workflow?._id, 
          error: workflowErr.message || workflowErr,
          stack: workflowErr.stack 
        });
      }
    });
    
    // Sort questions within each group
    Object.values(grouped).forEach(group => {
      if (group.questions) {
        group.questions.sort((a, b) => (a.order || 0) - (b.order || 0));
      }
    });
    
    res.status(200).json({ 
      status: 'success', 
      data: { workflows: rootWorkflows, count: rootWorkflows.length } 
    });
  } catch (err) {
    if (err.name === 'CastError') {
      return next(new AppError('Invalid workflow ID format', 400));
    }
    next(err);
  }
});

// Get workflows grouped by workflow group - LEGACY ROUTE
router.get('/grouped', authenticateToken, requireUserOrAdmin, async (req, res, next) => {
  try {
    const { includeInactive } = req.query;
    
    // Validate user ID
    if (!req.user || !req.user.id) {
      throw new AppError('User ID is required', 400);
    }
    
    // Validate user.id is a valid ObjectId format
    if (!mongoose.Types.ObjectId.isValid(req.user.id)) {
      throw new AppError('Invalid user ID format', 400);
    }
    
    const filter = { owner: req.user.id };
    if (!includeInactive) filter.isActive = true;
    
    let allWorkflows;
    try {
      allWorkflows = await ChatbotWorkflow.find(filter).sort({ order: 1, createdAt: 1 }).exec();
    } catch (findErr) {
      if (findErr.name === 'CastError') {
        logger.error('CastError in ChatbotWorkflow.find', { 
          filter, 
          error: findErr.message,
          user: req.user 
        });
        throw new AppError('Invalid workflow ID format in query', 400);
      }
      throw findErr;
    }
    
    // Group workflows by workflowGroupId (same logic as app-scoped route)
    const grouped = {};
    const rootWorkflows = [];
    
    allWorkflows.forEach(workflow => {
      try {
        if (!workflow._id) {
          logger.warn('Skipping workflow without _id', { workflow });
          return;
        }

        const workflowId = workflow._id.toString();
        const hasValidGroupId = workflow.workflowGroupId && 
                                workflow.workflowGroupId.toString && 
                                typeof workflow.workflowGroupId.toString === 'function';
        const isRoot = workflow.isRoot || (!hasValidGroupId);
        let groupId;
        if (isRoot) {
          groupId = workflowId;
        } else {
          try {
            groupId = hasValidGroupId ? workflow.workflowGroupId.toString() : workflowId;
          } catch (idErr) {
            logger.warn('Invalid workflowGroupId, treating as root', { 
              workflowId, 
              workflowGroupId: workflow.workflowGroupId 
            });
            groupId = workflowId;
          }
        }
        
        if (isRoot || groupId === workflowId) {
          if (!grouped[groupId]) {
            grouped[groupId] = {
              _id: workflowId,
              title: workflow.title,
              isActive: workflow.isActive,
              questions: []
            };
            rootWorkflows.push(grouped[groupId]);
          }
          grouped[groupId].rootQuestion = workflow;
          
          if ((!workflow.workflowGroupId || !hasValidGroupId) && workflow._id) {
            if (mongoose.Types.ObjectId.isValid(workflow._id)) {
              ChatbotWorkflow.findByIdAndUpdate(
                workflow._id,
                { workflowGroupId: workflow._id },
                { new: true }
              ).catch(err => logger.error('Failed to update workflowGroupId', { 
                workflowId: workflow._id, 
                error: err.message || err 
              }));
            }
          }
        } else {
          if (!grouped[groupId]) {
            const rootQuestion = allWorkflows.find(w => {
              if (!w._id) return false;
              try {
                const wId = w._id.toString();
                const wGroupId = (w.workflowGroupId && w.workflowGroupId.toString) 
                  ? w.workflowGroupId.toString() 
                  : null;
                return (wId === groupId && w.isRoot) || (wGroupId === groupId && w.isRoot);
              } catch {
                return false;
              }
            });
            
            grouped[groupId] = {
              _id: groupId,
              title: rootQuestion?.title || 'Unnamed Workflow',
              isActive: rootQuestion?.isActive ?? true,
              questions: []
            };
            if (rootQuestion) {
              grouped[groupId].rootQuestion = rootQuestion;
              if (!rootWorkflows.find(r => r._id === groupId)) {
                rootWorkflows.push(grouped[groupId]);
              }
            }
          }
          grouped[groupId].questions.push(workflow);
        }
      } catch (workflowErr) {
        logger.error('Error processing workflow in grouped endpoint', { 
          workflowId: workflow?._id, 
          error: workflowErr.message || workflowErr,
          stack: workflowErr.stack 
        });
      }
    });
    
    Object.values(grouped).forEach(group => {
      if (group.questions) {
        group.questions.sort((a, b) => (a.order || 0) - (b.order || 0));
      }
    });
    
    res.status(200).json({ 
      status: 'success', 
      data: { workflows: rootWorkflows, count: rootWorkflows.length } 
    });
  } catch (err) {
    if (err.name === 'CastError') {
      return next(new AppError('Invalid workflow ID format', 400));
    }
    next(err);
  }
});

// Get single workflow by ID for app - NEW APP-SCOPED ROUTE
router.get('/apps/:appId/:id', authenticateToken, verifyAppOwnership, async (req, res, next) => {
  try {
    const appId = req.appId;
    const workflow = await ChatbotWorkflow.findOne({ _id: req.params.id, owner: appId }).exec();
    if (!workflow) {
      throw new AppError('Workflow not found', 404);
    }
    res.status(200).json({ status: 'success', data: { workflow } });
  } catch (err) {
    if (err.name === 'CastError') return next(new AppError('Invalid workflow ID format', 400));
    next(err);
  }
});

// Get single workflow by ID - LEGACY ROUTE
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

// Update workflow for app - NEW APP-SCOPED ROUTE
router.patch('/apps/:appId/:id', authenticateToken, verifyAppOwnership, async (req, res, next) => {
  try {
    const { error, value } = workflowUpdateValidationSchema.validate(req.body, { abortEarly: false, stripUnknown: true });
    if (error) {
      const messages = error.details.map(d => d.message);
      throw new AppError(`Validation failed: ${messages.join(', ')}`, 400);
    }
    
    // Validate questionTypeId exists if provided
    const updateData = { ...value };
    if (value.questionTypeId !== undefined) {
      updateData.questionTypeId = await validateQuestionTypeId(value.questionTypeId);
    }
    
    const appId = req.appId;
    const workflow = await ChatbotWorkflow.findOneAndUpdate(
      { _id: req.params.id, owner: appId },
      updateData,
      { new: true, runValidators: true }
    ).exec();
    
    if (!workflow) {
      throw new AppError('Workflow not found', 404);
    }
    
    logger.info('ChatbotWorkflow updated', { workflowId: workflow._id, appId });
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

// Update workflow - LEGACY ROUTE
router.patch('/:id', authenticateToken, requireUserOrAdmin, async (req, res, next) => {
  try {
    const { error, value } = workflowUpdateValidationSchema.validate(req.body, { abortEarly: false, stripUnknown: true });
    if (error) {
      const messages = error.details.map(d => d.message);
      throw new AppError(`Validation failed: ${messages.join(', ')}`, 400);
    }
    
    // Validate questionTypeId exists if provided
    const updateData = { ...value };
    if (value.questionTypeId !== undefined) {
      updateData.questionTypeId = await validateQuestionTypeId(value.questionTypeId);
    }
    
    const workflow = await ChatbotWorkflow.findOneAndUpdate(
      { _id: req.params.id, owner: req.user.id },
      updateData,
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

// Delete workflow for app - NEW APP-SCOPED ROUTE
router.delete('/apps/:appId/:id', authenticateToken, verifyAppOwnership, async (req, res, next) => {
  try {
    const appId = req.appId;
    const workflow = await ChatbotWorkflow.findOneAndDelete({ _id: req.params.id, owner: appId }).exec();
    if (!workflow) {
      throw new AppError('Workflow not found', 404);
    }
    
    logger.info('ChatbotWorkflow deleted', { workflowId: req.params.id, appId });
    res.status(200).json({ 
      status: 'success', 
      message: 'Workflow deleted successfully' 
    });
  } catch (err) {
    if (err.name === 'CastError') return next(new AppError('Invalid workflow ID format', 400));
    next(err);
  }
});

// Delete workflow - LEGACY ROUTE
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
      // Validate all questionTypeId values exist
      await Promise.all(
        workflows.map(async (w) => {
          if (w.questionTypeId !== undefined) {
            await validateQuestionTypeId(w.questionTypeId);
          }
        })
      );
      
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
      .select('title question questionTypeId isRoot order')
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
