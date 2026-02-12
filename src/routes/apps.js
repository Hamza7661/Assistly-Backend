const express = require('express');
const router = express.Router();
const { App, appValidationSchema, appUpdateValidationSchema } = require('../models/App');
const { User } = require('../models/User');
const { logger } = require('../utils/logger');
const { AppError } = require('../utils/errorHandler');
const { authenticateToken } = require('../middleware/auth');
const { verifySignedThirdPartyForParamUser } = require('../middleware/thirdParty');
const SeedDataService = require('../services/seedDataService');
const { LEAD_TYPES_LIST } = require('../enums/leadTypes');
const cacheManager = require('../utils/cache');
const { Integration } = require('../models/Integration');
const { Questionnaire, QUESTIONNAIRE_TYPES } = require('../models/Questionnaire');
const { QuestionType } = require('../models/QuestionType');
const { ChatbotWorkflow } = require('../models/ChatbotWorkflow');

// Slug from label so value matches displayed text (e.g. "Catering" -> "catering")
function slugifyLeadValue(text) {
  if (!text || typeof text !== 'string') return '';
  return text.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '') || '';
}

// Use application-based lead type messages from Integration when present; otherwise fallback to default list
// Normalize value from text on read so all apps/industries get correct routing even if DB had stale value
function getLeadTypesFromIntegration(integration) {
  if (integration?.leadTypeMessages && Array.isArray(integration.leadTypeMessages) && integration.leadTypeMessages.length > 0) {
    const active = integration.leadTypeMessages
      .filter(m => m.isActive !== false)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    return active.map((m, idx) => {
      const text = m.text || '';
      const slug = slugifyLeadValue(text);
      const value = slug || m.value || `custom-${m.id ?? idx + 1}`;
      const out = {
        id: m.id,
        value,
        text,
        ...(Array.isArray(m.relevantServicePlans) && m.relevantServicePlans.length > 0 && { relevantServicePlans: m.relevantServicePlans }),
        ...(Array.isArray(m.synonyms) && m.synonyms.length > 0 && { synonyms: m.synonyms.filter(Boolean).map(s => String(s).trim()).filter(Boolean) })
      };
      if (m.labels && typeof m.labels === 'object') {
        out.labels = m.labels instanceof Map ? Object.fromEntries(m.labels) : m.labels;
      }
      return out;
    });
  }
  return LEAD_TYPES_LIST;
}

class AppController {
  // Helper to verify app ownership
  static async verifyAppOwnership(appId, userId) {
    // Don't allow access to deleted apps (handle both null and non-existent deletedAt)
    const app = await App.findOne({ 
      _id: appId,
      $or: [
        { deletedAt: null },
        { deletedAt: { $exists: false } }
      ]
    });
    if (!app) {
      throw new AppError('App not found', 404);
    }
    if (app.owner.toString() !== userId.toString()) {
      throw new AppError('You do not have permission to access this app', 403);
    }
    return app;
  }

  async createApp(req, res, next) {
    try {
      const userId = req.user.id;
      const { error, value } = appValidationSchema.validate(req.body, {
        abortEarly: false,
        stripUnknown: true
      });

      if (error) {
        const errorMessages = error.details.map(detail => detail.message);
        throw new AppError(`Validation failed: ${errorMessages.join(', ')}`, 400);
      }

      const { name, industry, description, whatsappOption, whatsappNumber } = value;

      // Check if app name already exists for this user (only check active apps, exclude deleted)
      const existingApp = await App.findOne({ 
        owner: userId, 
        name: name.trim(), 
        isActive: true,
        $or: [
          { deletedAt: null },
          { deletedAt: { $exists: false } }
        ]
      });
      if (existingApp) {
        throw new AppError('An app with this name already exists', 409);
      }

      const appData = {
        owner: userId,
        name: name.trim(),
        industry,
        description: description || '',
        isActive: true
      };

      // Handle WhatsApp number configuration
      if (whatsappOption === 'use-my-number' && whatsappNumber) {
        appData.whatsappNumber = whatsappNumber.trim();
        appData.whatsappNumberSource = 'user-provided';
        appData.whatsappNumberStatus = 'pending';
        // TODO: Register with Twilio Senders API (will be implemented in whatsappService)
      } else if (whatsappOption === 'get-from-twilio') {
        appData.whatsappNumberSource = 'twilio-provided';
        appData.whatsappNumberStatus = 'pending';
        // TODO: Provision Twilio number (will be implemented in whatsappService)
      }

      const app = new App(appData);
      await app.save();

      logger.info(`New app created: ${app.name} (${app._id}) by user ${userId}`);

      // Copy industry-based seed data to the new app
      try {
        const seedResults = await SeedDataService.copySeedDataToApp(app._id, industry);
        logger.info(`Seed data copied to app ${app._id}:`, seedResults);
      } catch (seedError) {
        // Log error but don't fail app creation if seed data copy fails
        logger.error(`Failed to copy seed data to app ${app._id}:`, seedError);
      }

      res.status(201).json({
        status: 'success',
        message: 'App created successfully',
        data: {
          app: {
            id: app._id,
            name: app.name,
            industry: app.industry,
            description: app.description,
            whatsappNumber: app.whatsappNumber,
            whatsappNumberSource: app.whatsappNumberSource,
            whatsappNumberStatus: app.whatsappNumberStatus,
            isActive: app.isActive,
            createdAt: app.createdAt,
            updatedAt: app.updatedAt
          }
        }
      });

    } catch (error) {
      if (error.name === 'MongoServerError' && error.code === 11000) {
        return next(new AppError('An app with this name already exists', 409));
      }
      next(error);
    }
  }

  async getApps(req, res, next) {
    try {
      const userId = req.user.id;
      const { includeInactive } = req.query;

      // Build query: exclude deleted apps (where deletedAt is NOT null)
      // Apps without deletedAt field will be included (they're not deleted yet)
      const query = { 
        owner: userId,
        $or: [
          { deletedAt: null },
          { deletedAt: { $exists: false } }
        ]
      };
      
      if (includeInactive !== 'true') {
        query.isActive = true;
      }

      const apps = await App.find(query)
        .sort({ createdAt: -1 })
        .select('-__v');

      res.status(200).json({
        status: 'success',
        data: {
          apps: apps.map(app => ({
            id: app._id,
            name: app.name,
            industry: app.industry,
            description: app.description,
            whatsappNumber: app.whatsappNumber,
            whatsappNumberSource: app.whatsappNumberSource,
            whatsappNumberStatus: app.whatsappNumberStatus,
            isActive: app.isActive,
            createdAt: app.createdAt,
            updatedAt: app.updatedAt
          }))
        }
      });

    } catch (error) {
      next(new AppError('Failed to retrieve apps', 500));
    }
  }

  async getApp(req, res, next) {
    try {
      const userId = req.user.id;
      const { id } = req.params;

      const app = await AppController.verifyAppOwnership(id, userId);

      res.status(200).json({
        status: 'success',
        data: {
          app: {
            id: app._id,
            name: app.name,
            industry: app.industry,
            description: app.description,
            whatsappNumber: app.whatsappNumber,
            whatsappNumberSource: app.whatsappNumberSource,
            whatsappNumberStatus: app.whatsappNumberStatus,
            twilioWhatsAppSenderId: app.twilioWhatsAppSenderId,
            isActive: app.isActive,
            createdAt: app.createdAt,
            updatedAt: app.updatedAt
          }
        }
      });

    } catch (error) {
      next(error);
    }
  }

  async updateApp(req, res, next) {
    try {
      const userId = req.user.id;
      const { id } = req.params;

      const { error, value } = appUpdateValidationSchema.validate(req.body, {
        abortEarly: false,
        stripUnknown: true
      });

      if (error) {
        const errorMessages = error.details.map(detail => detail.message);
        throw new AppError(`Validation failed: ${errorMessages.join(', ')}`, 400);
      }

      const app = await AppController.verifyAppOwnership(id, userId);

      // Check if name is being changed and if it conflicts (only check active apps, exclude deleted)
      if (value.name && value.name.trim() !== app.name) {
        const existingApp = await App.findOne({ 
          owner: userId, 
          name: value.name.trim(),
          isActive: true,
          $or: [
            { deletedAt: null },
            { deletedAt: { $exists: false } }
          ],
          _id: { $ne: id }
        });
        if (existingApp) {
          throw new AppError('An app with this name already exists', 409);
        }
        value.name = value.name.trim();
      }

      // Update app
      Object.keys(value).forEach(key => {
        app[key] = value[key];
      });

      await app.save();

      logger.info(`App updated: ${app.name} (${app._id}) by user ${userId}`);

      res.status(200).json({
        status: 'success',
        message: 'App updated successfully',
        data: {
          app: {
            id: app._id,
            name: app.name,
            industry: app.industry,
            description: app.description,
            whatsappNumber: app.whatsappNumber,
            whatsappNumberSource: app.whatsappNumberSource,
            whatsappNumberStatus: app.whatsappNumberStatus,
            twilioWhatsAppSenderId: app.twilioWhatsAppSenderId,
            isActive: app.isActive,
            createdAt: app.createdAt,
            updatedAt: app.updatedAt
          }
        }
      });

    } catch (error) {
      if (error.name === 'MongoServerError' && error.code === 11000) {
        return next(new AppError('An app with this name already exists', 409));
      }
      next(error);
    }
  }

  async deleteApp(req, res, next) {
    try {
      const userId = req.user.id;
      const { id } = req.params;

      const app = await AppController.verifyAppOwnership(id, userId);

      // Soft delete by setting isActive to false and deletedAt timestamp
      app.isActive = false;
      app.deletedAt = new Date();
      await app.save();

      logger.info(`App deleted (soft): ${app.name} (${app._id}) by user ${userId}`);

      res.status(200).json({
        status: 'success',
        message: 'App deleted successfully'
      });

    } catch (error) {
      next(error);
    }
  }

  async registerWhatsApp(req, res, next) {
    try {
      const userId = req.user.id;
      const { id } = req.params;

      const app = await AppController.verifyAppOwnership(id, userId);

      if (!app.whatsappNumber) {
        throw new AppError('WhatsApp number is not configured for this app', 400);
      }

      // TODO: Implement WhatsApp registration with Twilio Senders API
      // This will be implemented when whatsappService is created
      app.whatsappNumberStatus = 'pending';
      await app.save();

      logger.info(`WhatsApp registration triggered for app: ${app.name} (${app._id})`);

      res.status(200).json({
        status: 'success',
        message: 'WhatsApp registration initiated',
        data: {
          app: {
            id: app._id,
            whatsappNumberStatus: app.whatsappNumberStatus
          }
        }
      });

    } catch (error) {
      next(error);
    }
  }

  async getAppContextByTwilioNumber(req, res, next) {
    try {
      const { twilioPhoneNumber } = req.params;
      
      if (!twilioPhoneNumber) {
        return next(new AppError('Twilio phone number is required', 400));
      }

      // Find the app by Twilio phone number
      const app = await App.findByTwilioPhone(twilioPhoneNumber)
        .populate('owner', 'firstName lastName professionDescription website')
        .select('_id name industry owner')
        .exec();

      if (!app || !app.owner) {
        logger.warn('No app found with Twilio phone number', { 
          twilioPhoneNumber,
          suggestion: 'Run migration: node src/scripts/autoMigrateTwilioToApp.js'
        });
        return next(new AppError('No app found with this Twilio phone number', 404));
      }

      const user = app.owner;
      const appId = app._id;

      // Check cache first
      const cacheKey = cacheManager.getAppContextKey(appId);
      const cachedData = await cacheManager.get(cacheKey);
      
      if (cachedData) {
        logger.info('App context served from cache (by Twilio number)', { twilioPhoneNumber, appId });
        return res.status(200).json(cachedData);
      }

      // Fetch app-specific data (app-wise flow, no user fallback)
      const userApp = { _id: app._id, name: app.name, industry: app.industry };
      
      const treatmentPromise = Questionnaire.find({ owner: appId, type: QUESTIONNAIRE_TYPES.SERVICE_PLAN, isActive: true })
        .select('question answer attachedWorkflows')
        .populate('attachedWorkflows.workflowId', 'title question questionTypeId isRoot order')
        .sort({ updatedAt: -1 })
        .exec();

      const faqPromise = Questionnaire.find({ owner: appId, type: QUESTIONNAIRE_TYPES.FAQ, isActive: true })
        .select('question answer')
        .sort({ updatedAt: -1 })
        .exec();

      // App-wise: Only look for Integration by appId (no user fallback)
      const integrationPromise = Integration.findOne({ owner: appId }).exec();

      const workflowPromise = ChatbotWorkflow.find({ owner: appId })
        .select('title question questionTypeId isRoot order workflowGroupId isActive')
        .sort({ order: 1, createdAt: 1 })
        .exec();

      const [treatmentDocs, faqDocs, integration, workflowDocs] = await Promise.all([
        treatmentPromise, 
        faqPromise, 
        integrationPromise, 
        workflowPromise
      ]);

      // Get default question type
      const defaultQuestionType = await QuestionType.findOne({ isActive: true })
        .sort({ id: 1 })
        .select('id')
        .lean();
      const defaultQuestionTypeId = defaultQuestionType?.id || 1;

      // Process treatment plans
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
              questionTypeId: aw.workflowId.questionTypeId,
              isRoot: aw.workflowId.isRoot,
              order: aw.workflowId.order
            } : null
          }))
      }));

      const faq = faqDocs.map(d => ({ question: d.question, answer: d.answer }));

      // Process workflows (same logic as in user.js)
      const workflowMap = {};
      const rootWorkflows = [];
      
      workflowDocs.forEach(w => {
        const workflowData = {
          _id: w._id,
          title: w.title,
          question: w.question,
          questionTypeId: w.questionTypeId,
          isRoot: w.isRoot,
          order: w.order,
          workflowGroupId: w.workflowGroupId,
          isActive: w.isActive
        };
        
        if (w.isRoot || !w.workflowGroupId) {
          const groupId = w._id.toString();
          workflowMap[groupId] = {
            ...workflowData,
            questions: []
          };
          rootWorkflows.push(workflowMap[groupId]);
        } else {
          const groupId = w.workflowGroupId ? w.workflowGroupId.toString() : w._id.toString();
          if (!workflowMap[groupId]) {
            const rootWorkflow = workflowDocs.find(rw => 
              (rw._id.toString() === groupId && rw.isRoot) || 
              (rw.workflowGroupId && rw.workflowGroupId.toString() === groupId && rw.isRoot)
            );
            if (rootWorkflow) {
              workflowMap[groupId] = {
                _id: rootWorkflow._id,
                title: rootWorkflow.title,
                question: rootWorkflow.question,
                questionTypeId: rootWorkflow.questionTypeId,
                isRoot: rootWorkflow.isRoot,
                order: rootWorkflow.order,
                workflowGroupId: rootWorkflow.workflowGroupId,
                isActive: rootWorkflow.isActive,
                questions: []
              };
              rootWorkflows.push(workflowMap[groupId]);
            } else {
              workflowMap[groupId] = {
                _id: groupId,
                title: 'Unnamed Workflow',
                question: '',
                questionTypeId: defaultQuestionTypeId,
                isRoot: true,
                order: 0,
                isActive: true,
                questions: []
              };
            }
          }
          workflowMap[groupId].questions.push(workflowData);
        }
      });
      
      rootWorkflows.forEach(workflow => {
        if (workflow.questions) {
          workflow.questions = workflow.questions
            .filter(q => q.isActive !== false)
            .sort((a, b) => (a.order || 0) - (b.order || 0));
        }
        if (workflow.isActive === false) {
          const index = rootWorkflows.indexOf(workflow);
          if (index > -1) {
            rootWorkflows.splice(index, 1);
          }
        }
      });
      
      treatmentPlans.forEach(plan => {
        if (plan.attachedWorkflows && Array.isArray(plan.attachedWorkflows)) {
          plan.attachedWorkflows.forEach(attachedFlow => {
            if (attachedFlow.workflow && attachedFlow.workflow._id) {
              const existingIndex = rootWorkflows.findIndex(w => 
                w._id && w._id.toString() === attachedFlow.workflow._id.toString()
              );
              
              if (existingIndex === -1) {
                const workflowToAdd = {
                  ...attachedFlow.workflow,
                  treatmentPlanOrder: attachedFlow.order || 0,
                  treatmentPlanId: plan.question,
                  questions: attachedFlow.workflow.questions || []
                };
                rootWorkflows.push(workflowToAdd);
              } else {
                rootWorkflows[existingIndex].treatmentPlanOrder = attachedFlow.order || 0;
                rootWorkflows[existingIndex].treatmentPlanId = plan.question;
              }
            }
          });
        }
      });
      
      rootWorkflows.sort((a, b) => {
        const aOrder = a.treatmentPlanOrder !== undefined ? a.treatmentPlanOrder : (a.order || 0);
        const bOrder = b.treatmentPlanOrder !== undefined ? b.treatmentPlanOrder : (b.order || 0);
        if (aOrder !== bOrder) {
          return aOrder - bOrder;
        }
        return (a.order || 0) - (b.order || 0);
      });
      
      const workflows = rootWorkflows;

      // Prepare integration data
      const integrationData = integration ? {
        assistantName: integration.assistantName,
        companyName: integration.companyName || '',
        greeting: integration.greeting,
        validateEmail: integration.validateEmail,
        validatePhoneNumber: integration.validatePhoneNumber,
        googleReviewEnabled: !!integration.googleReviewEnabled,
        googleReviewUrl: integration.googleReviewUrl || null
      } : {
        assistantName: 'Assistant',
        companyName: '',
        greeting: process.env.DEFAULT_GREETING || 'Hi this is {assistantName} your virtual ai assistant from {companyName}. How can I help you today?',
        validateEmail: true,
        validatePhoneNumber: true,
        googleReviewEnabled: false,
        googleReviewUrl: null
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
          app: userApp ? { id: userApp._id, name: userApp.name, industry: userApp.industry } : null,
          leadTypes: getLeadTypesFromIntegration(integration),
          treatmentPlans,
          faq,
          integration: integrationData,
          workflows,
          country: process.env.COUNTRY
        }
      };

      // Cache the response for 5 minutes
      await cacheManager.set(cacheKey, responseData, 300);

      logger.info('App context retrieved by Twilio phone number (app-wise)', { 
        twilioPhoneNumber, 
        appId, 
        appName: app.name,
        industry: app.industry 
      });

      res.status(200).json(responseData);
    } catch (error) {
      logger.error('Error retrieving app context by Twilio number', {
        twilioPhoneNumber: req.params.twilioPhoneNumber,
        error: error.message,
        stack: error.stack,
        name: error.name
      });
      // Pass the original error to get more details
      next(error);
    }
  }
}

const appController = new AppController();

// Routes
router.post('/', authenticateToken, appController.createApp);
router.get('/', authenticateToken, appController.getApps);
router.get('/by-twilio/:twilioPhoneNumber/context', verifySignedThirdPartyForParamUser, appController.getAppContextByTwilioNumber);
router.get('/:id', authenticateToken, appController.getApp);
router.put('/:id', authenticateToken, appController.updateApp);
router.delete('/:id', authenticateToken, appController.deleteApp);
router.post('/:id/whatsapp/register', authenticateToken, appController.registerWhatsApp);

module.exports = router;
