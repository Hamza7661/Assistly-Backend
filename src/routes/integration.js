const express = require('express');
const router = express.Router();
const { Integration, integrationValidationSchema, integrationUpdateValidationSchema } = require('../models/Integration');
const { logger } = require('../utils/logger');
const { AppError } = require('../utils/errorHandler');
const { authenticateToken, requireUserOrAdmin } = require('../middleware/auth');
const { verifySignedThirdPartyForParamUser } = require('../middleware/thirdParty');
const { uploadSingle } = require('../middleware/upload');

class IntegrationController {
  async getIntegration(req, res, next) {
    try {
      const { id } = req.params;
      const userId = id || req.user.id;


      if (!userId) {
        return next(new AppError('User ID is required', 400));
      }

      let integration = await Integration.findOne({ owner: userId });

      // Create default integration if none exists
      if (!integration) {
        integration = new Integration({
          owner: userId,
          chatbotImage: {
            data: null,
            contentType: null,
            filename: null
          },
          assistantName: 'Assistant',
          greeting: process.env.DEFAULT_GREETING || 'Hello! How can I help you today?',
          primaryColor: process.env.DEFAULT_PRIMARY_COLOR || '#3B82F6',
          validateEmail: true,
          validatePhoneNumber: true
        });
        await integration.save();
      } 

      logger.info('Retrieved integration settings', { userId });

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
            greeting: integration.greeting,
            primaryColor: integration.primaryColor,
            validateEmail: integration.validateEmail,
            validatePhoneNumber: integration.validatePhoneNumber,
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
      const { id } = req.params;
      const userId = id || req.user.id;
      const updateData = req.body;

      if (!userId) {
        return next(new AppError('User ID is required', 400));
      }

      // Validate input
      const { error, value } = integrationUpdateValidationSchema.validate(updateData);
      if (error) {
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
        { owner: userId },
        value,
        { 
          new: true, 
          runValidators: true, 
          upsert: true,
          setDefaultsOnInsert: true
        }
      );

      logger.info('Updated integration settings', { userId, updatedFields: Object.keys(value) });

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
            greeting: integration.greeting,
            primaryColor: integration.primaryColor,
            validateEmail: integration.validateEmail,
            validatePhoneNumber: integration.validatePhoneNumber,
            createdAt: integration.createdAt,
            updatedAt: integration.updatedAt
          }
        }
      });
    } catch (error) {
      if (error.name === 'CastError') {
        return next(new AppError('Invalid user ID format', 400));
      }
      if (error.name === 'ValidationError') {
        return next(new AppError(error.message, 400));
      }
      next(new AppError('Failed to update integration settings', 500));
    }
  }

  async getPublicIntegration(req, res, next) {
    try {
      const { id } = req.params;

      if (!id) {
        return next(new AppError('User ID is required', 400));
      }

      let integration = await Integration.findOne({ owner: id });

      // Return default values if no integration exists
      if (!integration) {
        integration = {
          chatbotImage: {
            data: null,
            contentType: null,
            filename: null
          },
          assistantName: 'Assistant',
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
            primaryColor: integration.primaryColor
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
      const { id } = req.params;
      const userId = id || req.user.id;

      if (!userId) {
        return next(new AppError('User ID is required', 400));
      }

      const integration = await Integration.findOne({ owner: userId });

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

// Authenticated routes
router.get('/me', authenticateToken, integrationController.getIntegration);
router.put('/me', authenticateToken, uploadSingle('chatbotImage'), integrationController.updateIntegration);
router.get('/me/image', authenticateToken, integrationController.getChatbotImage);
router.get('/user/:id', authenticateToken, requireUserOrAdmin, integrationController.getIntegration);
router.put('/user/:id', authenticateToken, requireUserOrAdmin, uploadSingle('chatbotImage'), integrationController.updateIntegration);
router.get('/user/:id/image', authenticateToken, requireUserOrAdmin, integrationController.getChatbotImage);

// Public routes (HMAC protected)
router.get('/public/:id', verifySignedThirdPartyForParamUser, integrationController.getPublicIntegration);
router.get('/public/:id/me', verifySignedThirdPartyForParamUser, integrationController.getIntegration);

module.exports = router;