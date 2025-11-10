const express = require('express');
const router = express.Router();
const { User } = require('../models/User');
const { logger } = require('../utils/logger');
const { AppError } = require('../utils/errorHandler');
const { Questionnaire, QUESTIONNAIRE_TYPES } = require('../models/Questionnaire');
const { LEAD_TYPES_LIST } = require('../enums/leadTypes');
const { SERVICES_LIST } = require('../enums/services');
const { Integration } = require('../models/Integration');
const cacheManager = require('../utils/cache');
const { authenticateToken, requireAdmin, requireUserOrAdmin } = require('../middleware/auth');
const { verifySignedThirdPartyForParamUser } = require('../middleware/thirdParty');

class UserController {
  async getPublicUser(req, res, next) {
    try {
      const { id } = req.params;

      if (!id) {
        return next(new AppError('User ID is required', 400));
      }

      const user = await User.findById(id)
        .select('firstName lastName professionDescription website');

      if (!user) {
        return next(new AppError('User not found', 404));
      }

      res.status(200).json({
        status: 'success',
        data: {
          user: {
            id: user._id,
            firstName: user.firstName,
            lastName: user.lastName,
            professionDescription: user.professionDescription,
            website: user.website
          }
        }
      });
    } catch (error) {
      if (error.name === 'CastError') {
        return next(new AppError('Invalid user ID format', 400));
      }
      next(new AppError('Failed to retrieve user', 500));
    }
  }

  async getPublicUserKnowledge(req, res, next) {
    try {
      const { id } = req.params;

      if (!id) {
        return next(new AppError('User ID is required', 400));
      }

      const userPromise = User.findById(id)
        .select('firstName lastName professionDescription website')
        .exec();

      const faqPromise = Questionnaire.find({ owner: id, type: QUESTIONNAIRE_TYPES.FAQ, isActive: true })
        .select('question answer')
        .sort({ updatedAt: -1 })
        .exec();

      const treatmentPromise = Questionnaire.find({ owner: id, type: QUESTIONNAIRE_TYPES.TREATMENT_PLAN, isActive: true })
        .select('question answer')
        .sort({ updatedAt: -1 })
        .exec();

      const [user, faqDocs, treatmentDocs] = await Promise.all([userPromise, faqPromise, treatmentPromise]);

      if (!user) {
        return next(new AppError('User not found', 404));
      }

      const faqs = faqDocs.map(d => ({ question: d.question, answer: d.answer }));
      const treatmentPlans = treatmentDocs.map(d => ({ question: d.question, answer: d.answer }));

      res.status(200).json({
        status: 'success',
        data: {
          user: {
            id: user._id,
            firstName: user.firstName,
            lastName: user.lastName,
            professionDescription: user.professionDescription,
            website: user.website
          },
          faq: faqs,
          treatmentPlans: treatmentPlans
        }
      });
    } catch (error) {
      if (error.name === 'CastError') {
        return next(new AppError('Invalid user ID format', 400));
      }
      next(new AppError('Failed to retrieve user knowledge', 500));
    }
  }

  async getThirdPartyUserContext(req, res, next) {
    try {
      const { id } = req.params;

      if (!id) {
        return next(new AppError('User ID is required', 400));
      }

      // Check cache first
      const cacheKey = cacheManager.getUserContextKey(id);
      const cachedData = await cacheManager.get(cacheKey);
      
      if (cachedData) {
        logger.info('User context served from cache', { userId: id });
        return res.status(200).json(cachedData);
      }

      const userPromise = User.findById(id)
        .select('firstName lastName professionDescription website')
        .exec();

      const treatmentPromise = Questionnaire.find({ owner: id, type: QUESTIONNAIRE_TYPES.TREATMENT_PLAN, isActive: true })
        .select('question answer attachedWorkflows')
        .populate('attachedWorkflows.workflowId', 'title question questionType options isRoot order')
        .sort({ updatedAt: -1 })
        .exec();

      const faqPromise = Questionnaire.find({ owner: id, type: QUESTIONNAIRE_TYPES.FAQ, isActive: true })
        .select('question answer')
        .sort({ updatedAt: -1 })
        .exec();

      const integrationPromise = Integration.findOne({ owner: id })
        .exec();

      const { ChatbotWorkflow } = require('../models/ChatbotWorkflow');
      const workflowPromise = ChatbotWorkflow.find({ owner: id, isActive: true })
        .select('title question questionType options isRoot order workflowGroupId')
        .sort({ order: 1, createdAt: 1 })
        .exec();

      const [user, treatmentDocs, faqDocs, integration, workflowDocs] = await Promise.all([userPromise, treatmentPromise, faqPromise, integrationPromise, workflowPromise]);

      if (!user) {
        return next(new AppError('User not found', 404));
      }

      const treatmentPlans = treatmentDocs.map(d => ({
        question: d.question,
        answer: d.answer,
        attachedWorkflows: (d.attachedWorkflows || [])
          .filter(aw => aw.workflowId)
          .sort((a, b) => (a.order || 0) - (b.order || 0))
          .map(aw => ({
            workflowId: aw.workflowId._id || aw.workflowId,
            order: aw.order || 0,
            workflow: aw.workflowId ? {
              _id: aw.workflowId._id,
              title: aw.workflowId.title,
              question: aw.workflowId.question,
              questionType: aw.workflowId.questionType,
              options: aw.workflowId.options,
              isRoot: aw.workflowId.isRoot,
              order: aw.workflowId.order
            } : null
          }))
      }));
      const faq = faqDocs.map(d => ({ question: d.question, answer: d.answer }));

      // Group workflows by workflowGroupId and include ordered questions
      const workflowMap = {};
      const rootWorkflows = [];
      
      workflowDocs.forEach(w => {
        const workflowData = {
          _id: w._id,
          title: w.title,
          question: w.question,
          questionType: w.questionType,
          options: w.options,
          isRoot: w.isRoot,
          order: w.order,
          workflowGroupId: w.workflowGroupId
        };
        
        if (w.isRoot || !w.workflowGroupId) {
          // This is a root workflow
          const groupId = w._id.toString();
          workflowMap[groupId] = {
            ...workflowData,
            questions: [] // Will contain ordered questions
          };
          rootWorkflows.push(workflowMap[groupId]);
        } else {
          // This is a question within a workflow
          const groupId = w.workflowGroupId ? w.workflowGroupId.toString() : w._id.toString();
          if (!workflowMap[groupId]) {
            // Find the root workflow for this group
            const rootWorkflow = workflowDocs.find(rw => 
              (rw._id.toString() === groupId && rw.isRoot) || 
              (rw.workflowGroupId && rw.workflowGroupId.toString() === groupId && rw.isRoot)
            );
            if (rootWorkflow) {
              workflowMap[groupId] = {
                _id: rootWorkflow._id,
                title: rootWorkflow.title,
                question: rootWorkflow.question,
                questionType: rootWorkflow.questionType,
                options: rootWorkflow.options,
                isRoot: rootWorkflow.isRoot,
                order: rootWorkflow.order,
                workflowGroupId: rootWorkflow.workflowGroupId,
                questions: []
              };
              rootWorkflows.push(workflowMap[groupId]);
            } else {
              // Create a placeholder if root not found
              workflowMap[groupId] = {
                _id: groupId,
                title: 'Unnamed Workflow',
                question: '',
                questionType: 'single_choice',
                options: [],
                isRoot: true,
                order: 0,
                questions: []
              };
            }
          }
          workflowMap[groupId].questions.push(workflowData);
        }
      });
      
      // Sort questions within each workflow by order
      rootWorkflows.forEach(workflow => {
        if (workflow.questions) {
          workflow.questions.sort((a, b) => (a.order || 0) - (b.order || 0));
        }
      });
      
      const workflows = rootWorkflows;

      // Prepare integration data
      const integrationData = integration ? {
        assistantName: integration.assistantName,
        greeting: integration.greeting,
        validateEmail: integration.validateEmail,
        validatePhoneNumber: integration.validatePhoneNumber
      } : {
        assistantName: 'Assistant',
        greeting: process.env.DEFAULT_GREETING || 'Hello! How can I help you today?',
        validateEmail: true,
        validatePhoneNumber: true
      };

      const responseData = {
        status: 'success',
        data: {
          user: {
            id: user._id,
            firstName: user.firstName,
            lastName: user.lastName,
            professionDescription: user.professionDescription,
            website: user.website
          },
          leadTypes: LEAD_TYPES_LIST,
          services: SERVICES_LIST,
          treatmentPlans,
          faq,
          integration: integrationData,
          workflows,
          country: process.env.COUNTRY
        }
      };

      // Cache the response for 5 minutes
      await cacheManager.set(cacheKey, responseData, 300);

      res.status(200).json(responseData);
    } catch (error) {
      if (error.name === 'CastError') {
        return next(new AppError('Invalid user ID format', 400));
      }
      next(new AppError('Failed to retrieve user context', 500));
    }
  }

  async getUserContextByTwilioNumber(req, res, next) {
    try {
      const { twilioPhoneNumber } = req.params;

      if (!twilioPhoneNumber) {
        return next(new AppError('Twilio phone number is required', 400));
      }

      // First, find the user by Twilio phone number
      const user = await User.findByTwilioPhone(twilioPhoneNumber)
        .select('_id firstName lastName professionDescription website')
        .exec();

      if (!user) {
        return next(new AppError('User not found with this Twilio phone number', 404));
      }

      const userId = user._id;

      // Check cache first
      const cacheKey = cacheManager.getUserContextKey(userId);
      const cachedData = await cacheManager.get(cacheKey);
      
      if (cachedData) {
        logger.info('User context served from cache (by Twilio number)', { twilioPhoneNumber, userId });
        return res.status(200).json(cachedData);
      }

      const treatmentPromise = Questionnaire.find({ owner: userId, type: QUESTIONNAIRE_TYPES.TREATMENT_PLAN, isActive: true })
        .select('question answer attachedWorkflows')
        .populate('attachedWorkflows.workflowId', 'title question questionType options isRoot order')
        .sort({ updatedAt: -1 })
        .exec();

      const faqPromise = Questionnaire.find({ owner: userId, type: QUESTIONNAIRE_TYPES.FAQ, isActive: true })
        .select('question answer')
        .sort({ updatedAt: -1 })
        .exec();

      const integrationPromise = Integration.findOne({ owner: userId })
        .exec();

      const { ChatbotWorkflow } = require('../models/ChatbotWorkflow');
      const workflowPromise = ChatbotWorkflow.find({ owner: userId, isActive: true })
        .select('title question questionType options isRoot order workflowGroupId')
        .sort({ order: 1, createdAt: 1 })
        .exec();

      const [treatmentDocs, faqDocs, integration, workflowDocs] = await Promise.all([treatmentPromise, faqPromise, integrationPromise, workflowPromise]);

      const treatmentPlans = treatmentDocs.map(d => ({
        question: d.question,
        answer: d.answer,
        attachedWorkflows: (d.attachedWorkflows || [])
          .filter(aw => aw.workflowId)
          .sort((a, b) => (a.order || 0) - (b.order || 0))
          .map(aw => ({
            workflowId: aw.workflowId._id || aw.workflowId,
            order: aw.order || 0,
            workflow: aw.workflowId ? {
              _id: aw.workflowId._id,
              title: aw.workflowId.title,
              question: aw.workflowId.question,
              questionType: aw.workflowId.questionType,
              options: aw.workflowId.options,
              isRoot: aw.workflowId.isRoot,
              order: aw.workflowId.order
            } : null
          }))
      }));
      const faq = faqDocs.map(d => ({ question: d.question, answer: d.answer }));

      // Group workflows by workflowGroupId and include ordered questions
      const workflowMap = {};
      const rootWorkflows = [];
      
      workflowDocs.forEach(w => {
        const workflowData = {
          _id: w._id,
          title: w.title,
          question: w.question,
          questionType: w.questionType,
          options: w.options,
          isRoot: w.isRoot,
          order: w.order,
          workflowGroupId: w.workflowGroupId
        };
        
        if (w.isRoot || !w.workflowGroupId) {
          // This is a root workflow
          const groupId = w._id.toString();
          workflowMap[groupId] = {
            ...workflowData,
            questions: [] // Will contain ordered questions
          };
          rootWorkflows.push(workflowMap[groupId]);
        } else {
          // This is a question within a workflow
          const groupId = w.workflowGroupId ? w.workflowGroupId.toString() : w._id.toString();
          if (!workflowMap[groupId]) {
            // Find the root workflow for this group
            const rootWorkflow = workflowDocs.find(rw => 
              (rw._id.toString() === groupId && rw.isRoot) || 
              (rw.workflowGroupId && rw.workflowGroupId.toString() === groupId && rw.isRoot)
            );
            if (rootWorkflow) {
              workflowMap[groupId] = {
                _id: rootWorkflow._id,
                title: rootWorkflow.title,
                question: rootWorkflow.question,
                questionType: rootWorkflow.questionType,
                options: rootWorkflow.options,
                isRoot: rootWorkflow.isRoot,
                order: rootWorkflow.order,
                workflowGroupId: rootWorkflow.workflowGroupId,
                questions: []
              };
              rootWorkflows.push(workflowMap[groupId]);
            } else {
              // Create a placeholder if root not found
              workflowMap[groupId] = {
                _id: groupId,
                title: 'Unnamed Workflow',
                question: '',
                questionType: 'single_choice',
                options: [],
                isRoot: true,
                order: 0,
                questions: []
              };
            }
          }
          workflowMap[groupId].questions.push(workflowData);
        }
      });
      
      // Sort questions within each workflow by order
      rootWorkflows.forEach(workflow => {
        if (workflow.questions) {
          workflow.questions.sort((a, b) => (a.order || 0) - (b.order || 0));
        }
      });
      
      const workflows = rootWorkflows;

      // Prepare integration data
      const integrationData = integration ? {
        assistantName: integration.assistantName,
        greeting: integration.greeting,
        validateEmail: integration.validateEmail,
        validatePhoneNumber: integration.validatePhoneNumber
      } : {
        assistantName: 'Assistant',
        greeting: process.env.DEFAULT_GREETING || 'Hello! How can I help you today?',
        validateEmail: true,
        validatePhoneNumber: true
      };

      const responseData = {
        status: 'success',
        data: {
          user: {
            id: user._id,
            firstName: user.firstName,
            lastName: user.lastName,
            professionDescription: user.professionDescription,
            website: user.website
          },
          leadTypes: LEAD_TYPES_LIST,
          services: SERVICES_LIST,
          treatmentPlans,
          faq,
          integration: integrationData,
          workflows,
          country: process.env.COUNTRY
        }
      };

      // Cache the response for 5 minutes
      await cacheManager.set(cacheKey, responseData, 300);

      logger.info('User context retrieved by Twilio phone number', { twilioPhoneNumber, userId });

      res.status(200).json(responseData);
    } catch (error) {
      next(new AppError('Failed to retrieve user context by Twilio phone number', 500));
    }
  }
  async getCurrentUser(req, res, next) {
    try {
      const userId = req.user.id;
      
      if (!userId) {
        return next(new AppError('User ID not found in token', 401));
      }

      const user = await User.findById(userId)
        .select('-password -refreshToken')
        .populate('package', 'name price limits features type');

      if (!user) {
        return next(new AppError('User not found', 404));
      }

      if (!user.isActive) {
        return next(new AppError('Account is deactivated', 401));
      }

      logger.info('Retrieved current user profile', { userId });

      res.status(200).json({
        status: 'success',
        data: {
          user
        }
      });
    } catch (error) {
      if (error.name === 'CastError') {
        return next(new AppError('Invalid user ID format', 400));
      }
      next(new AppError('Failed to retrieve current user', 500));
    }
  }

  // JWT third-party issuance removed: HMAC-only path

  async getAllUsers(req, res, next) {
    try {
      const users = await User.find({}).select('-password -refreshToken');
      
      logger.info('Retrieved all users', { count: users.length });
      
      res.status(200).json({
        status: 'success',
        data: {
          users,
          count: users.length
        }
      });
    } catch (error) {
      next(new AppError('Failed to retrieve users', 500));
    }
  }

  async getUserById(req, res, next) {
    try {
      const { id } = req.params;
      
      if (!id) {
        return next(new AppError('User ID is required', 400));
      }

      const user = await User.findById(id)
        .select('-password -refreshToken')
        .populate('package', 'name price limits features type');

      if (!user) {
        return next(new AppError('User not found', 404));
      }

      logger.info('Retrieved user by ID', { userId: id });

      res.status(200).json({
        status: 'success',
        data: {
          user
        }
      });
    } catch (error) {
      if (error.name === 'CastError') {
        return next(new AppError('Invalid user ID format', 400));
      }
      next(new AppError('Failed to retrieve user', 500));
    }
  }

  async getUserByTwilioNumber(req, res, next) {
    try {
      const { twilioPhoneNumber } = req.params;

      if (!twilioPhoneNumber) {
        return next(new AppError('Twilio phone number is required', 400));
      }

      const user = await User.findByTwilioPhone(twilioPhoneNumber)
        .select('-password -refreshToken')
        .populate('package', 'name price limits features type');

      if (!user) {
        return next(new AppError('User not found with this Twilio phone number', 404));
      }

      logger.info('Retrieved user by Twilio phone number', { twilioPhoneNumber });

      res.status(200).json({
        status: 'success',
        data: {
          user
        }
      });
    } catch (error) {
      next(new AppError('Failed to retrieve user by Twilio phone number', 500));
    }
  }

  async updateUser(req, res, next) {
    try {
      const { id } = req.params;
      const updateData = req.body;

      if (!id) {
        return next(new AppError('User ID is required', 400));
      }

      const allowedUpdates = ['firstName', 'lastName', 'phoneNumber', 'email', 'profession', 'professionDescription', 'package', 'website', 'twilioPhoneNumber'];
      const filteredUpdates = {};

      Object.keys(updateData).forEach(key => {
        if (!allowedUpdates.includes(key)) return;
        let value = updateData[key];

        // Map alias 'profession' -> 'professionDescription'
        const targetKey = key === 'profession' ? 'professionDescription' : key;

        // Treat empty string website as null (clear)
        if (targetKey === 'website' && (value === '' || value === undefined)) {
          value = null;
        }

        filteredUpdates[targetKey] = value;
      });

      if (Object.keys(filteredUpdates).length === 0) {
        return next(new AppError('No valid fields to update', 400));
      }

      const user = await User.findByIdAndUpdate(
        id,
        filteredUpdates,
        { new: true, runValidators: true }
      ).select('-password -refreshToken');

      if (!user) {
        return next(new AppError('User not found', 404));
      }

      logger.info('Updated user', { userId: id, updatedFields: Object.keys(filteredUpdates) });

      res.status(200).json({
        status: 'success',
        data: {
          user
        }
      });
    } catch (error) {
      if (error.name === 'CastError') {
        return next(new AppError('Invalid user ID format', 400));
      }
      if (error.name === 'ValidationError') {
        return next(new AppError(error.message, 400));
      }
      next(new AppError('Failed to update user', 500));
    }
  }

  async deleteUser(req, res, next) {
    try {
      const { id } = req.params;

      if (!id) {
        return next(new AppError('User ID is required', 400));
      }

      const user = await User.findByIdAndDelete(id);

      if (!user) {
        return next(new AppError('User not found', 404));
      }

      logger.info('Deleted user', { userId: id });

      res.status(200).json({
        status: 'success',
        message: 'User deleted successfully'
      });
    } catch (error) {
      if (error.name === 'CastError') {
        return next(new AppError('Invalid user ID format', 400));
      }
      next(new AppError('Failed to delete user', 500));
    }
  }
}

const userController = new UserController();

router.get('/me', authenticateToken, userController.getCurrentUser);
router.get('/', authenticateToken, requireAdmin, userController.getAllUsers);
router.get('/public/:id', userController.getPublicUser);
router.get('/public/:id/knowledge', verifySignedThirdPartyForParamUser, userController.getPublicUserKnowledge);
router.get('/public/:id/context', verifySignedThirdPartyForParamUser, userController.getThirdPartyUserContext);
router.get('/by-twilio/:twilioPhoneNumber', verifySignedThirdPartyForParamUser, userController.getUserByTwilioNumber);
router.get('/by-twilio/:twilioPhoneNumber/context', verifySignedThirdPartyForParamUser, userController.getUserContextByTwilioNumber);
router.get('/:id', authenticateToken, requireUserOrAdmin, userController.getUserById);
router.put('/:id', authenticateToken, requireUserOrAdmin, userController.updateUser);
router.delete('/:id', authenticateToken, requireAdmin, userController.deleteUser);

module.exports = router;
