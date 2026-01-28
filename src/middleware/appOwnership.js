const { App } = require('../models/App');
const { AppError } = require('../utils/errorHandler');
const { logger } = require('../utils/logger');

/**
 * Middleware to verify that the user owns the app specified in the request
 * Expects appId in req.params.appId or req.query.appId
 */
const verifyAppOwnership = async (req, res, next) => {
  try {
    const appId = req.params.appId || req.query.appId;
    const userId = req.user?.id;

    if (!appId) {
      return next(new AppError('App ID is required', 400));
    }

    if (!userId) {
      return next(new AppError('Authentication required', 401));
    }

    const app = await App.findById(appId);
    
    if (!app) {
      return next(new AppError('App not found', 404));
    }

    if (app.owner.toString() !== userId.toString()) {
      logger.warn(`Unauthorized app access attempt: user ${userId} tried to access app ${appId}`);
      return next(new AppError('You do not have permission to access this app', 403));
    }

    if (!app.isActive) {
      return next(new AppError('This app has been deleted', 404));
    }

    // Attach app to request for use in controllers
    req.app = app;
    req.appId = appId;

    next();
  } catch (error) {
    if (error.name === 'CastError') {
      return next(new AppError('Invalid app ID format', 400));
    }
    next(new AppError('Failed to verify app ownership', 500));
  }
};

module.exports = {
  verifyAppOwnership
};
