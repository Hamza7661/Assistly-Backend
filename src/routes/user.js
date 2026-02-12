const express = require('express');
const router = express.Router();
const { User } = require('../models/User');
const { logger } = require('../utils/logger');
const { AppError } = require('../utils/errorHandler');
const { Questionnaire, QUESTIONNAIRE_TYPES } = require('../models/Questionnaire');
const { QuestionType } = require('../models/QuestionType');
const { LEAD_TYPES_LIST } = require('../enums/leadTypes');
const { Integration } = require('../models/Integration');
const { App } = require('../models/App');
const cacheManager = require('../utils/cache');
const { authenticateToken, requireAdmin, requireUserOrAdmin } = require('../middleware/auth');
const { verifySignedThirdPartyForParamUser } = require('../middleware/thirdParty');

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

      const treatmentPromise = Questionnaire.find({ owner: id, type: QUESTIONNAIRE_TYPES.SERVICE_PLAN, isActive: true })
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

      const treatmentPromise = Questionnaire.find({ owner: id, type: QUESTIONNAIRE_TYPES.SERVICE_PLAN, isActive: true })
        .select('question answer attachedWorkflows')
        .populate('attachedWorkflows.workflowId', 'title question questionTypeId isRoot order')
        .sort({ updatedAt: -1 })
        .exec();

      const faqPromise = Questionnaire.find({ owner: id, type: QUESTIONNAIRE_TYPES.FAQ, isActive: true })
        .select('question answer')
        .sort({ updatedAt: -1 })
        .exec();

      const integrationPromise = Integration.findOne({ owner: id })
        .exec();

      const { ChatbotWorkflow } = require('../models/ChatbotWorkflow');
      const workflowPromise = ChatbotWorkflow.find({ owner: id })
        .select('title question questionTypeId isRoot order workflowGroupId isActive')
        .sort({ order: 1, createdAt: 1 })
        .exec();

      const [user, treatmentDocs, faqDocs, integration, workflowDocs] = await Promise.all([userPromise, treatmentPromise, faqPromise, integrationPromise, workflowPromise]);

      if (!user) {
        return next(new AppError('User not found', 404));
      }

      // Get default question type (first active question type)
      const defaultQuestionType = await QuestionType.findOne({ isActive: true })
        .sort({ id: 1 })
        .select('id')
        .lean();
      const defaultQuestionTypeId = defaultQuestionType?.id || 1;

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

      // Group workflows by workflowGroupId and include ordered questions
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
                questionTypeId: rootWorkflow.questionTypeId,
                isRoot: rootWorkflow.isRoot,
                order: rootWorkflow.order,
                workflowGroupId: rootWorkflow.workflowGroupId,
                isActive: rootWorkflow.isActive,
                questions: []
              };
              rootWorkflows.push(workflowMap[groupId]);
            } else {
              // Create a placeholder if root not found
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
      
      // Sort questions within each workflow by order and filter out inactive questions
      rootWorkflows.forEach(workflow => {
        if (workflow.questions) {
          workflow.questions = workflow.questions
            .filter(q => q.isActive !== false) // Only include active questions
            .sort((a, b) => (a.order || 0) - (b.order || 0));
        }
        // Also filter out inactive root workflows
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

      res.status(200).json(responseData);
    } catch (error) {
      if (error.name === 'CastError') {
        return next(new AppError('Invalid user ID format', 400));
      }
      next(new AppError('Failed to retrieve user context', 500));
    }
  }

  async getThirdPartyAppContext(req, res, next) {
    try {
      const { appId } = req.params;

      if (!appId) {
        return next(new AppError('App ID is required', 400));
      }

      const cacheKey = cacheManager.getAppContextKey(appId);
      const cachedData = await cacheManager.get(cacheKey);

      if (cachedData) {
        logger.info('App context served from cache', { appId });
        return res.status(200).json(cachedData);
      }

      const app = await App.findById(appId).select('name industry owner').populate('owner', 'firstName lastName professionDescription website').exec();
      if (!app || !app.owner) {
        return next(new AppError('App not found', 404));
      }
      const user = app.owner;
      const userId = user._id;

      const treatmentPromise = Questionnaire.find({ owner: appId, type: QUESTIONNAIRE_TYPES.SERVICE_PLAN, isActive: true })
        .select('question answer attachedWorkflows')
        .populate('attachedWorkflows.workflowId', 'title question questionTypeId isRoot order')
        .sort({ updatedAt: -1 })
        .exec();

      const faqPromise = Questionnaire.find({ owner: appId, type: QUESTIONNAIRE_TYPES.FAQ, isActive: true })
        .select('question answer')
        .sort({ updatedAt: -1 })
        .exec();

      // TEMPORARY: Look for Integration by appId first, then fall back to userId during migration
      // Once all apps have their own Integration, remove the fallback
      const integrationPromise = Integration.findOne({ owner: appId })
        .exec()
        .then(integration => {
          if (integration) return integration;
          // Fallback to user-scoped integration (temporary during migration)
          return Integration.findOne({ owner: userId }).exec();
        });

      const { ChatbotWorkflow } = require('../models/ChatbotWorkflow');
      const workflowPromise = ChatbotWorkflow.find({ owner: appId })
        .select('title question questionTypeId isRoot order workflowGroupId isActive')
        .sort({ order: 1, createdAt: 1 })
        .exec();

      const [treatmentDocs, faqDocs, integration, workflowDocs] = await Promise.all([treatmentPromise, faqPromise, integrationPromise, workflowPromise]);

      const defaultQuestionType = await QuestionType.findOne({ isActive: true })
        .sort({ id: 1 })
        .select('id')
        .lean();
      const defaultQuestionTypeId = defaultQuestionType?.id || 1;

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
          workflowMap[groupId] = { ...workflowData, questions: [] };
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
          if (index > -1) rootWorkflows.splice(index, 1);
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
                rootWorkflows.push({
                  ...attachedFlow.workflow,
                  treatmentPlanOrder: attachedFlow.order || 0,
                  treatmentPlanId: plan.question,
                  questions: attachedFlow.workflow.questions || []
                });
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
        if (aOrder !== bOrder) return aOrder - bOrder;
        return (a.order || 0) - (b.order || 0);
      });

      const workflows = rootWorkflows;

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
          app: {
            id: app._id,
            name: app.name,
            industry: app.industry
          },
          leadTypes: getLeadTypesFromIntegration(integration),
          treatmentPlans,
          faq,
          integration: integrationData,
          workflows,
          country: process.env.COUNTRY
        }
      };

      await cacheManager.set(cacheKey, responseData, 300);
      logger.info('App context retrieved', { appId });

      res.status(200).json(responseData);
    } catch (error) {
      if (error.name === 'CastError') {
        return next(new AppError('Invalid app ID format', 400));
      }
      next(new AppError('Failed to retrieve app context', 500));
    }
  }

  async getUserContextByTwilioNumber(req, res, next) {
    try {
      const { twilioPhoneNumber } = req.params;

      if (!twilioPhoneNumber) {
        return next(new AppError('Twilio phone number is required', 400));
      }

      // Find the app directly by Twilio phone number
      const App = require('../models/App');
      const app = await App.findByTwilioPhone(twilioPhoneNumber)
        .populate('owner', 'firstName lastName professionDescription website')
        .select('_id name industry owner')
        .exec();

      if (!app || !app.owner) {
        return next(new AppError('No app found with this Twilio phone number. Please assign the Twilio number to an app using the migration script.', 404));
      }

      const user = app.owner;
      const appId = app._id;
      const userId = user._id;

      // Check cache first
      const cacheKey = cacheManager.getAppContextKey(appId);
      const cachedData = await cacheManager.get(cacheKey);
      
      if (cachedData) {
        logger.info('App context served from cache (by Twilio number)', { twilioPhoneNumber, appId });
        return res.status(200).json(cachedData);
      }

      // Use appId for querying context data (app-specific, not user-specific)
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

      // TEMPORARY: Look for Integration by appId first, then fall back to userId during migration
      // Once all apps have their own Integration, remove the fallback
      const integrationPromise = Integration.findOne({ owner: appId })
        .exec()
        .then(integration => {
          if (integration) return integration;
          // Fallback to user-scoped integration (temporary during migration)
          return Integration.findOne({ owner: userId }).exec();
        });

      const { ChatbotWorkflow } = require('../models/ChatbotWorkflow');
      const workflowPromise = ChatbotWorkflow.find({ owner: appId })
        .select('title question questionTypeId isRoot order workflowGroupId isActive')
        .sort({ order: 1, createdAt: 1 })
        .exec();

      const [treatmentDocs, faqDocs, integration, workflowDocs] = await Promise.all([treatmentPromise, faqPromise, integrationPromise, workflowPromise]);

      // Get default question type (first active question type)
      const defaultQuestionType = await QuestionType.findOne({ isActive: true })
        .sort({ id: 1 })
        .select('id')
        .lean();
      const defaultQuestionTypeId = defaultQuestionType?.id || 1;

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

      // Group workflows by workflowGroupId and include ordered questions
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
                questionTypeId: rootWorkflow.questionTypeId,
                isRoot: rootWorkflow.isRoot,
                order: rootWorkflow.order,
                workflowGroupId: rootWorkflow.workflowGroupId,
                isActive: rootWorkflow.isActive,
                questions: []
              };
              rootWorkflows.push(workflowMap[groupId]);
            } else {
              // Create a placeholder if root not found
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
      
      // Sort questions within each workflow by order and filter out inactive questions
      rootWorkflows.forEach(workflow => {
        if (workflow.questions) {
          workflow.questions = workflow.questions
            .filter(q => q.isActive !== false) // Only include active questions
            .sort((a, b) => (a.order || 0) - (b.order || 0));
        }
        // Also filter out inactive root workflows
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
          app: userApp ? { id: userApp._id, name: userApp.name, industry: userApp.industry } : null, // Include app for WhatsApp/Voice leads
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

      const allowedUpdates = ['firstName', 'lastName', 'phoneNumber', 'email', 'profession', 'professionDescription', 'industry', 'region', 'package', 'website', 'twilioPhoneNumber', 'preferences'];
      const filteredUpdates = {};

      // Get current user to check existing industry
      const currentUser = await User.findById(id);
      if (!currentUser) {
        return next(new AppError('User not found', 404));
      }

      // Merge preferences (e.g. preferredLanguages) so we don't wipe other preference keys
      if (updateData.preferences && typeof updateData.preferences === 'object') {
        const prefs = currentUser.preferences || {};
        if (Array.isArray(updateData.preferences.preferredLanguages)) {
          if (updateData.preferences.preferredLanguages.length > 3) {
            return next(new AppError('Preferred languages cannot exceed 3', 400));
          }
          prefs.preferredLanguages = updateData.preferences.preferredLanguages.filter(Boolean).map((c) => String(c).trim().toLowerCase()).slice(0, 3);
        }
        filteredUpdates.preferences = prefs;
      }

      Object.keys(updateData).forEach(key => {
        if (!allowedUpdates.includes(key)) return;
        if (key === 'preferences') return; // already handled above
        let value = updateData[key];

        // Map alias 'profession' -> 'professionDescription'
        const targetKey = key === 'profession' ? 'professionDescription' : key;

        // Prevent changing industry if it's already set
        if (targetKey === 'industry') {
          if (currentUser.industry && currentUser.industry.trim() !== '') {
            // Industry is already set, don't allow changes
            return;
          }
          // Skip empty strings for industry
          if (!value || value.trim() === '') {
            return; // Don't include empty industry
          }
        }

        // Treat empty string website as null (clear)
        if (targetKey === 'website' && (value === '' || value === undefined)) {
          value = null;
        }

        // Skip undefined/null values for other fields (but allow empty strings for optional fields)
        if (value === undefined || value === null) {
          return;
        }

        filteredUpdates[targetKey] = value;
      });

      if (Object.keys(filteredUpdates).length === 0) {
        return next(new AppError('No valid fields to update', 400));
      }

      logger.info('Updating user fields', { userId: id, fields: Object.keys(filteredUpdates), values: filteredUpdates });

      // Use the currentUser we already fetched, just update it
      Object.assign(currentUser, filteredUpdates);
      await currentUser.save({ runValidators: true });
      
      // Populate package for response
      const user = await User.findById(id)
        .select('-password -refreshToken')
        .populate('package', 'name price limits features type');

      logger.info('Updated user successfully', { userId: id, updatedFields: Object.keys(filteredUpdates), industry: user.industry });

      res.status(200).json({
        status: 'success',
        data: {
          user
        }
      });
    } catch (error) {
      logger.error('Error updating user', { error: error.message, stack: error.stack, userId: id, updateData: filteredUpdates });
      if (error.name === 'CastError') {
        return next(new AppError('Invalid user ID format', 400));
      }
      if (error.name === 'ValidationError') {
        const validationErrors = Object.values(error.errors || {}).map((err) => err.message).join(', ');
        return next(new AppError(`Validation failed: ${validationErrors || error.message}`, 400));
      }
      next(new AppError(`Failed to update user: ${error.message}`, 500));
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
router.get('/public/apps/:appId/context', verifySignedThirdPartyForParamUser, userController.getThirdPartyAppContext);
router.get('/by-twilio/:twilioPhoneNumber', verifySignedThirdPartyForParamUser, userController.getUserByTwilioNumber);
router.get('/by-twilio/:twilioPhoneNumber/context', verifySignedThirdPartyForParamUser, userController.getUserContextByTwilioNumber);
router.get('/:id', authenticateToken, requireUserOrAdmin, userController.getUserById);
router.put('/:id', authenticateToken, requireUserOrAdmin, userController.updateUser);
router.delete('/:id', authenticateToken, requireAdmin, userController.deleteUser);

module.exports = router;
