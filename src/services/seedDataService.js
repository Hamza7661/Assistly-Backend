const { IndustrySeed } = require('../models/IndustrySeed');
const { ChatbotWorkflow } = require('../models/ChatbotWorkflow');
const { Questionnaire } = require('../models/Questionnaire');
const { App } = require('../models/App');
const { Integration } = require('../models/Integration');
const { logger } = require('../utils/logger');
const { AppError } = require('../utils/errorHandler');
const { QUESTIONNAIRE_TYPES } = require('../enums/questionnaireTypes');
const websocketServer = require('../utils/websocketServer');

class SeedDataService {
  /**
   * Copy seed data from industry template to a new app
   * @param {string} appId - The app ID to copy seed data to
   * @param {string} industry - The industry type
   * @param {string} userId - The user ID for WebSocket progress updates
   */
  static async copySeedDataToApp(appId, industry, userId = null) {
    const emitProgress = (step, message, progress, total) => {
      if (userId) {
        websocketServer.broadcastAppCreationProgress(userId, {
          step,
          message,
          progress,
          total,
          percentage: Math.round((progress / total) * 100)
        });
      }
    };

    try {
      // Verify app exists
      const app = await App.findById(appId);
      if (!app) {
        throw new AppError('App not found', 404);
      }

      emitProgress('initializing', 'Initializing seed data...', 0, 5);

      // Get industry seed data
      const seedData = await IndustrySeed.findOne({ industry, isActive: true });
      if (!seedData) {
        logger.warn(`No seed data found for industry: ${industry}. App ${appId} will be created without default content.`);
        return { workflows: 0, faqs: 0, leadTypes: 0, servicePlans: 0 };
      }

      const results = {
        workflows: 0,
        faqs: 0,
        leadTypes: 0,
        servicePlans: 0
      };

      // Store workflow mapping for linking
      let workflowMap = new Map(); // Map workflow title to workflow ID

      // Copy workflows first to get workflow IDs for linking
      emitProgress('workflows', 'Creating conversation workflows...', 1, 5);
      if (seedData.workflows && seedData.workflows.length > 0) {
        const workflowResult = await this.copyWorkflows(appId, seedData.workflows);
        results.workflows = workflowResult.count;
        workflowMap = workflowResult.workflowMap;
      }

      // Copy FAQs
      emitProgress('faqs', 'Setting up FAQs...', 2, 5);
      if (seedData.faqs && seedData.faqs.length > 0) {
        results.faqs = await this.copyFAQs(appId, seedData.faqs);
      }

      // Copy service plans (as treatment plans in Questionnaire) with linked workflows
      emitProgress('servicePlans', 'Configuring service plans...', 3, 5);
      if (seedData.servicePlans && seedData.servicePlans.length > 0) {
        results.servicePlans = await this.copyServicePlans(appId, seedData.servicePlans, workflowMap, seedData.leadTypes);
      }

      // Copy lead types to Integration model with service plan links
      emitProgress('leadTypes', 'Setting up lead types...', 4, 5);
      if (seedData.leadTypes && seedData.leadTypes.length > 0) {
        results.leadTypes = await this.copyLeadTypes(appId, seedData.leadTypes, workflowMap);
      }

      // Copy introduction message to Integration greeting
      if (seedData.introduction) {
        await this.copyIntroduction(appId, seedData.introduction);
      }

      emitProgress('complete', 'App created successfully!', 5, 5);
      logger.info(`Seed data copied to app ${appId} (${industry}):`, results);
      return results;

    } catch (error) {
      if (userId) {
        websocketServer.broadcastAppCreationProgress(userId, {
          step: 'error',
          message: 'Failed to copy seed data',
          error: error.message
        });
      }
      logger.error(`Error copying seed data to app ${appId}:`, error);
      throw error;
    }
  }

  /**
   * Copy workflows recursively, maintaining parent-child relationships
   */
  static async copyWorkflows(appId, workflows, parentWorkflowId = null) {
    let count = 0;
    const workflowMap = new Map(); // Map workflow title to workflow ID
    const rootWorkflows = [];

    // First pass: create all root workflows and store their IDs
    for (let i = 0; i < workflows.length; i++) {
      const workflowTemplate = workflows[i];
      if (workflowTemplate.isRoot) {
        const workflowData = {
          owner: appId,
          title: workflowTemplate.title,
          question: workflowTemplate.question,
          questionTypeId: workflowTemplate.questionTypeId || 1,
          isRoot: true,
          isActive: true,
          order: workflowTemplate.order || 0,
          workflowGroupId: null // Will be set after creation
        };

        const workflow = new ChatbotWorkflow(workflowData);
        await workflow.save();

        // Set workflowGroupId to itself for root workflows
        workflow.workflowGroupId = workflow._id;
        await workflow.save();

        // Map by title for easy linking
        workflowMap.set(workflowTemplate.title, workflow._id);
        rootWorkflows.push({ template: workflowTemplate, newId: workflow._id, index: i });
        count++;
      }
    }

    // Second pass: create child workflows for each root
    for (const rootWorkflow of rootWorkflows) {
      if (rootWorkflow.template.children && rootWorkflow.template.children.length > 0) {
        const childResult = await this.copyChildWorkflows(appId, rootWorkflow.template.children, rootWorkflow.newId, workflowMap);
        count += childResult.count;
      }
    }

    // Third pass: create any non-root workflows that aren't children
    for (let i = 0; i < workflows.length; i++) {
      const workflowTemplate = workflows[i];
      if (!workflowTemplate.isRoot && !workflowMap.has(workflowTemplate.title)) {
        // This is a standalone non-root workflow (shouldn't happen in normal structure, but handle it)
        const workflowData = {
          owner: appId,
          title: workflowTemplate.title,
          question: workflowTemplate.question,
          questionTypeId: workflowTemplate.questionTypeId || 1,
          isRoot: false,
          isActive: true,
          order: workflowTemplate.order || 0,
          workflowGroupId: parentWorkflowId || null
        };

        const workflow = new ChatbotWorkflow(workflowData);
        await workflow.save();
        workflowMap.set(workflowTemplate.title, workflow._id);
        count++;

        if (workflowTemplate.children && workflowTemplate.children.length > 0) {
          const childResult = await this.copyChildWorkflows(appId, workflowTemplate.children, workflow._id, workflowMap);
          count += childResult.count;
        }
      }
    }

    return { count, workflowMap };
  }

  /**
   * Helper to copy child workflows recursively
   */
  static async copyChildWorkflows(appId, childTemplates, parentWorkflowId, workflowMap) {
    let count = 0;

    for (const childTemplate of childTemplates) {
      const workflowData = {
        owner: appId,
        title: childTemplate.title,
        question: childTemplate.question,
        questionTypeId: childTemplate.questionTypeId || 1,
        isRoot: false,
        isActive: true,
        order: childTemplate.order || 0,
        workflowGroupId: parentWorkflowId
      };

      const workflow = new ChatbotWorkflow(workflowData);
      await workflow.save();
      
      // Map by title for easy linking
      workflowMap.set(childTemplate.title, workflow._id);
      count++;

      // Recursively copy grandchildren
      if (childTemplate.children && childTemplate.children.length > 0) {
        const grandchildResult = await this.copyChildWorkflows(appId, childTemplate.children, workflow._id, workflowMap);
        count += grandchildResult.count;
      }
    }

    return { count, workflowMap };
  }

  /**
   * Copy FAQs to app
   */
  static async copyFAQs(appId, faqs) {
    const faqDocuments = faqs.map(faq => ({
      owner: appId,
      type: QUESTIONNAIRE_TYPES.FAQ,
      question: faq.question,
      answer: faq.answer,
      isActive: true
    }));

    await Questionnaire.insertMany(faqDocuments);
    return faqDocuments.length;
  }

  /**
   * Copy service plans (Questionnaire with type SERVICE_PLAN) with workflow links
   */
  static async copyServicePlans(appId, servicePlans, workflowMap, leadTypes = []) {
    // Create a map of service name to linked workflows based on lead types
    const serviceToWorkflowMap = new Map();
    
    if (leadTypes && leadTypes.length > 0) {
      for (const leadType of leadTypes) {
        if (leadType.linkedService && leadType.linkedWorkflow) {
          if (!serviceToWorkflowMap.has(leadType.linkedService)) {
            serviceToWorkflowMap.set(leadType.linkedService, []);
          }
          const workflowId = workflowMap.get(leadType.linkedWorkflow);
          if (workflowId && !serviceToWorkflowMap.get(leadType.linkedService).includes(workflowId.toString())) {
            serviceToWorkflowMap.get(leadType.linkedService).push(workflowId);
          }
        }
      }
    }
    
    const planDocuments = servicePlans.map(plan => {
      // Get linked workflows for this service plan
      const linkedWorkflows = serviceToWorkflowMap.get(plan.name) || [];
      
      return {
        owner: appId,
        type: QUESTIONNAIRE_TYPES.SERVICE_PLAN,
        question: plan.name,
        answer: plan.description || '',
        isActive: true,
        attachedWorkflows: [...new Set(linkedWorkflows)] // Remove duplicates
      };
    });

    await Questionnaire.insertMany(planDocuments);
    logger.info(`Service plans copied: ${planDocuments.length} plans, ${planDocuments.filter(p => p.attachedWorkflows.length > 0).length} with linked workflows`);
    return planDocuments.length;
  }

  /**
   * Copy lead types to Integration model with service plan links
   */
  static async copyLeadTypes(appId, leadTypes, workflowMap) {
    try {
      // Map seed lead types to Integration leadTypeMessages format with service plan links
      const leadTypeMessages = leadTypes.map((lt, index) => {
        const message = {
          id: lt.id,
          value: lt.value,
          text: lt.text,
          isActive: true,
          order: index
        };
        
        // Add linked service plan (relevantServicePlans field in Integration model)
        // This links the lead type to specific service plans
        if (lt.linkedService) {
          message.relevantServicePlans = [lt.linkedService];
        }
        
        return message;
      });

      // Use findOneAndUpdate to bypass pre-save hook and ensure lead types are set
      // This ensures industry-specific lead types are set even if Integration already exists
      const integration = await Integration.findOneAndUpdate(
        { owner: appId },
        { 
          $set: { leadTypeMessages: leadTypeMessages },
          $setOnInsert: {
            owner: appId,
            assistantName: 'Assistant',
            companyName: '',
            greeting: process.env.DEFAULT_GREETING || 'Hi this is {assistantName} your virtual ai assistant from {companyName}. How can I help you today?',
            primaryColor: process.env.DEFAULT_PRIMARY_COLOR || '#3B82F6',
            validateEmail: true,
            validatePhoneNumber: true
          }
        },
        { 
          upsert: true, 
          new: true,
          runValidators: true
        }
      );

      logger.info(`Lead types copied to Integration for app ${appId}: ${leadTypeMessages.length} types with service plan links`);
      return leadTypeMessages.length;
    } catch (error) {
      logger.error(`Error copying lead types to Integration for app ${appId}:`, error);
      throw error;
    }
  }

  /**
   * Copy introduction message to Integration greeting
   */
  static async copyIntroduction(appId, introduction) {
    try {
      // Use findOneAndUpdate to ensure greeting is set correctly
      await Integration.findOneAndUpdate(
        { owner: appId },
        { 
          $set: { greeting: introduction },
          $setOnInsert: {
            owner: appId,
            assistantName: 'Assistant',
            companyName: '',
            primaryColor: process.env.DEFAULT_PRIMARY_COLOR || '#3B82F6',
            validateEmail: true,
            validatePhoneNumber: true
          }
        },
        { 
          upsert: true, 
          new: true
        }
      );

      logger.info(`Introduction message copied to Integration greeting for app ${appId}`);
    } catch (error) {
      logger.error(`Error copying introduction to Integration for app ${appId}:`, error);
      throw error;
    }
  }

  /**
   * Get seed data for an industry
   */
  static async getSeedData(industry) {
    return await IndustrySeed.findOne({ industry, isActive: true });
  }

  /**
   * Create or update seed data for an industry
   */
  static async upsertSeedData(industry, seedData) {
    return await IndustrySeed.findOneAndUpdate(
      { industry },
      {
        ...seedData,
        industry,
        updatedAt: new Date()
      },
      { upsert: true, new: true }
    );
  }
}

module.exports = SeedDataService;
