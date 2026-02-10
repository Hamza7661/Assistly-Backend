const express = require('express');
const router = express.Router();
const { Integration, integrationValidationSchema, integrationUpdateValidationSchema } = require('../models/Integration');
const { logger } = require('../utils/logger');
const { AppError } = require('../utils/errorHandler');
const { authenticateToken, requireUserOrAdmin } = require('../middleware/auth');
const { verifySignedThirdPartyForParamUser } = require('../middleware/thirdParty');
const { verifyAppOwnership } = require('../middleware/appOwnership');
const { uploadSingle } = require('../middleware/upload');

class IntegrationController {
  async getIntegration(req, res, next) {
    try {
      const appId = req.appId || req.params.appId;
      
      if (!appId) {
        return next(new AppError('App ID is required', 400));
      }

      let integration = await Integration.findOne({ owner: appId });

      // Create default integration if none exists
      if (!integration) {
        integration = new Integration({
          owner: appId,
          chatbotImage: {
            data: null,
            contentType: null,
            filename: null
          },
          assistantName: 'Assistant',
          companyName: '',
          greeting: process.env.DEFAULT_GREETING || 'Hi this is {assistantName} your virtual ai assistant from {companyName}. How can I help you today?',
          primaryColor: process.env.DEFAULT_PRIMARY_COLOR || '#3B82F6',
          validateEmail: true,
          validatePhoneNumber: true
        });
        await integration.save();
      } 

      logger.info('Retrieved integration settings', { appId });

      const responseData = {
        status: 'success',
        data: {
          integration: {
            id: integration._id,
            owner: integration.owner,
            chatbotImage: integration.chatbotImage.data ? {
              hasImage: true,
              contentType: integration.chatbotImage.contentType,
              filename: integration.chatbotImage.filename,
              data: integration.chatbotImage.data.toString('base64')
            } : {
              hasImage: false,
              contentType: null,
              filename: null,
              data: null
            },
            assistantName: integration.assistantName,
            companyName: integration.companyName,
            greeting: integration.greeting,
            primaryColor: integration.primaryColor,
            validateEmail: integration.validateEmail,
            validatePhoneNumber: integration.validatePhoneNumber,
            googleReviewEnabled: integration.googleReviewEnabled || false,
            googleReviewUrl: integration.googleReviewUrl || null,
            leadTypeMessages: integration.leadTypeMessages || [],
            createdAt: integration.createdAt,
            updatedAt: integration.updatedAt
          }
        }
      };


      res.status(200).json(responseData);
    } catch (error) {

      if (error.name === 'CastError') {
        return next(new AppError('Invalid user ID format', 400));
      }
      next(new AppError('Failed to retrieve integration settings', 500));
    }
  }

  async updateIntegration(req, res, next) {
    try {
      const appId = req.appId || req.params.appId;
      let updateData = { ...req.body };

      if (!appId) {
        return next(new AppError('App ID is required', 400));
      }

      // Coerce FormData booleans (sent as strings)
      if (typeof updateData.googleReviewEnabled === 'string') {
        updateData.googleReviewEnabled = updateData.googleReviewEnabled === 'true';
      }

      // Handle leadTypeMessages from FormData (it comes as a JSON string)
      if (updateData.leadTypeMessages && typeof updateData.leadTypeMessages === 'string') {
        try {
          updateData.leadTypeMessages = JSON.parse(updateData.leadTypeMessages);
        } catch (e) {
          logger.error('Failed to parse leadTypeMessages', { error: e });
          // If parsing fails, remove it from updateData so validation can handle it
          delete updateData.leadTypeMessages;
        }
      }

      // Strip _id and keep value in sync with text (slug) so backend/AI filtering matches the displayed label
      if (updateData.leadTypeMessages && Array.isArray(updateData.leadTypeMessages)) {
        const slugify = (t) => (t || '').trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '') || null;
        updateData.leadTypeMessages = updateData.leadTypeMessages.map((msg, idx) => {
          const { _id, ...rest } = msg;
          const text = (rest.text || '').trim();
          const slug = slugify(rest.text);
          // Value must match label so "Catering" -> value "catering"; fallback to existing value or custom-{id}
          rest.value = slug || rest.value || `custom-${rest.id ?? idx + 1}`;
          return rest;
        });
      }

      // Validate input
      const { error, value } = integrationUpdateValidationSchema.validate(updateData, {
        stripUnknown: true,
        abortEarly: false
      });
      if (error) {
        logger.error('Validation error:', { error: error.details, updateData: Object.keys(updateData) });
        return next(new AppError(error.details[0].message, 400));
      }

      // Handle file upload for chatbot image
      if (req.file) {
        value.chatbotImage = {
          data: req.file.buffer,
          contentType: req.file.mimetype,
          filename: req.file.originalname
        };
      }

      const integration = await Integration.findOneAndUpdate(
        { owner: appId },
        value,
        { 
          new: true, 
          runValidators: true, 
          upsert: true,
          setDefaultsOnInsert: true
        }
      );

      logger.info('Updated integration settings', { appId, updatedFields: Object.keys(value) });

      res.status(200).json({
        status: 'success',
        data: {
          integration: {
            id: integration._id,
            owner: integration.owner,
            chatbotImage: integration.chatbotImage.data ? {
              hasImage: true,
              contentType: integration.chatbotImage.contentType,
              filename: integration.chatbotImage.filename,
              data: integration.chatbotImage.data.toString('base64')
            } : {
              hasImage: false,
              contentType: null,
              filename: null,
              data: null
            },
            assistantName: integration.assistantName,
            companyName: integration.companyName,
            greeting: integration.greeting,
            primaryColor: integration.primaryColor,
            validateEmail: integration.validateEmail,
            validatePhoneNumber: integration.validatePhoneNumber,
            leadTypeMessages: integration.leadTypeMessages || [],
            createdAt: integration.createdAt,
            updatedAt: integration.updatedAt
          }
        }
      });
    } catch (error) {
      if (error.name === 'CastError') {
        return next(new AppError('Invalid app ID format', 400));
      }
      if (error.name === 'ValidationError') {
        return next(new AppError(error.message, 400));
      }
      next(new AppError('Failed to update integration settings', 500));
    }
  }

  async getPublicIntegration(req, res, next) {
    try {
      const appId = req.params.appId || req.params.id;

      if (!appId) {
        return next(new AppError('App ID is required', 400));
      }

      let integration = await Integration.findOne({ owner: appId });

      // Return default values if no integration exists
      if (!integration) {
        integration = {
          chatbotImage: {
            data: null,
            contentType: null,
            filename: null
          },
          assistantName: 'Assistant',
          companyName: '',
          greeting: process.env.DEFAULT_GREETING || 'Hello! How can I help you today?',
          primaryColor: process.env.DEFAULT_PRIMARY_COLOR || '#3B82F6'
        };
      }

      res.status(200).json({
        status: 'success',
        data: {
          integration: {
            chatbotImage: integration.chatbotImage.data ? {
              hasImage: true,
              contentType: integration.chatbotImage.contentType,
              filename: integration.chatbotImage.filename,
              data: integration.chatbotImage.data.toString('base64')
            } : {
              hasImage: false,
              contentType: null,
              filename: null,
              data: null
            },
            assistantName: integration.assistantName,
            greeting: integration.greeting,
            primaryColor: integration.primaryColor,
            leadTypeMessages: integration.leadTypeMessages || []
          }
        }
      });
    } catch (error) {
      if (error.name === 'CastError') {
        return next(new AppError('Invalid user ID format', 400));
      }
      next(new AppError('Failed to retrieve public integration settings', 500));
    }
  }

  async getChatbotImage(req, res, next) {
    try {
      const appId = req.appId || req.params.appId;

      if (!appId) {
        return next(new AppError('App ID is required', 400));
      }

      const integration = await Integration.findOne({ owner: appId });

      if (!integration || !integration.chatbotImage.data) {
        return next(new AppError('Chatbot image not found', 404));
      }

      res.set({
        'Content-Type': integration.chatbotImage.contentType,
        'Content-Disposition': `inline; filename="${integration.chatbotImage.filename}"`,
        'Cache-Control': 'public, max-age=31536000' // 1 year cache
      });

      res.send(integration.chatbotImage.data);
    } catch (error) {
      if (error.name === 'CastError') {
        return next(new AppError('Invalid user ID format', 400));
      }
      next(new AppError('Failed to retrieve chatbot image', 500));
    }
  }
}

const integrationController = new IntegrationController();

// Routes with appId parameter (new structure)
router.get('/apps/:appId', authenticateToken, verifyAppOwnership, integrationController.getIntegration);
router.put('/apps/:appId', authenticateToken, verifyAppOwnership, uploadSingle('chatbotImage'), integrationController.updateIntegration);
router.get('/apps/:appId/image', authenticateToken, verifyAppOwnership, integrationController.getChatbotImage);

// Public routes (HMAC protected) - for widget access
router.get('/public/apps/:appId', verifySignedThirdPartyForParamUser, integrationController.getPublicIntegration);

module.exports = router;