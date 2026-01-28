const express = require('express');
const router = express.Router();
const { App, appValidationSchema, appUpdateValidationSchema } = require('../models/App');
const { User } = require('../models/User');
const { logger } = require('../utils/logger');
const { AppError } = require('../utils/errorHandler');
const { authenticateToken } = require('../middleware/auth');
const SeedDataService = require('../services/seedDataService');

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
}

const appController = new AppController();

// Routes
router.post('/', authenticateToken, appController.createApp);
router.get('/', authenticateToken, appController.getApps);
router.get('/:id', authenticateToken, appController.getApp);
router.put('/:id', authenticateToken, appController.updateApp);
router.delete('/:id', authenticateToken, appController.deleteApp);
router.post('/:id/whatsapp/register', authenticateToken, appController.registerWhatsApp);

module.exports = router;
