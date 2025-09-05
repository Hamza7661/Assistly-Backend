require('dotenv').config();
const express = require('express');
const path = require('path');
const morgan = require('morgan');

const databaseManager = require('./config/database');
const securityMiddleware = require('./middleware/security');
const { logger, logRequest } = require('./utils/logger');
const { globalErrorHandler, notFoundHandler } = require('./utils/errorHandler');

const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/user');
const packageRoutes = require('./routes/packages');
const emailRoutes = require('./routes/email');
// const faqRoutes = require('./routes/faq');
const questionnaireRoutes = require('./routes/questionnaire');
const availabilityRoutes = require('./routes/availability');

class Application {
  constructor() {
    this.app = express();
    this.port = process.env.PORT || 3000;
    this.isProduction = process.env.NODE_ENV === 'production';
    
    this.initializeMiddleware();
    this.initializeRoutes();
    this.initializeErrorHandling();
  }

  initializeMiddleware() {
    securityMiddleware.applySecurityMiddleware(this.app);
    
    if (!this.isProduction) {
      this.app.use(morgan('dev'));
    } else {
      this.app.use(morgan('combined', {
        stream: {
          write: (message) => logger.info(message.trim())
        }
      }));
    }

    this.app.use(logRequest);
    
    this.app.use(express.static(path.join(__dirname, 'public')));
  }

  initializeRoutes() {
    const apiPrefix = process.env.API_PREFIX || '/api';
    const apiVersion = process.env.API_VERSION || 'v1';
    const basePath = `${apiPrefix}/${apiVersion}`;

    this.app.use(`${basePath}/auth`, securityMiddleware.getRateLimiters().auth, authRoutes);
    this.app.use(`${basePath}/users`, securityMiddleware.getRateLimiters().api, userRoutes);
    this.app.use(`${basePath}/packages`, securityMiddleware.getRateLimiters().api, packageRoutes);
    this.app.use(`${basePath}/email`, securityMiddleware.getRateLimiters().api, emailRoutes);
    // this.app.use(`${basePath}/faq`, securityMiddleware.getRateLimiters().api, faqRoutes);
    this.app.use(`${basePath}/questionnaire`, securityMiddleware.getRateLimiters().api, questionnaireRoutes);
    this.app.use(`${basePath}/availability`, securityMiddleware.getRateLimiters().api, availabilityRoutes);

    this.app.get('/', (req, res) => {
      res.json({
        status: 'success',
        message: 'Welcome to Assistly Backend API',
        version: process.env.npm_package_version || '1.0.0',
        environment: process.env.NODE_ENV || 'development',
        documentation: `${req.protocol}://${req.get('host')}${basePath}/docs`
      });
    });
  }

  initializeErrorHandling() {
    this.app.use(notFoundHandler);
    this.app.use(globalErrorHandler);
  }

  async start() {
    try {
      await databaseManager.connect();
      
      const server = this.app.listen(this.port, () => {
        logger.info(`🚀 Assistly Backend running on port ${this.port}`);
        logger.info(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
        logger.info(`🔗 API Base: ${process.env.API_PREFIX || '/api'}/${process.env.API_VERSION || 'v1'}`);

      });

      // Keep-alive timeout: 65 seconds, Headers timeout: 66 seconds (must be > keepAliveTimeout)
      server.keepAliveTimeout = 65000; // 65 seconds
      server.headersTimeout = 66000; // 66 seconds

      this.setupGracefulShutdown(server);
      
      return server;
    } catch (error) {
      logger.error('Failed to start application:', error);
      process.exit(1);
    }
  }

  setupGracefulShutdown(server) {
    const gracefulShutdown = async (signal) => {
      logger.info(`Received ${signal}. Starting graceful shutdown...`);
      
      server.close(async () => {
        logger.info('HTTP server closed');
        
        try {
          await databaseManager.disconnect();
          logger.info('Graceful shutdown completed');
          process.exit(0);
        } catch (error) {
          logger.error('Error during graceful shutdown:', error);
          process.exit(1);
        }
      });

      // Force shutdown after 10 seconds if graceful shutdown fails
      setTimeout(() => {
        logger.error('Could not close connections in time, forcefully shutting down');
        process.exit(1);
      }, 10000); // 10 seconds timeout
    };

    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));

    process.on('uncaughtException', (err) => {
      logger.error('Uncaught Exception:', err);
      process.exit(1);
    });

    process.on('unhandledRejection', (reason, promise) => {
      logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
      process.exit(1);
    });
  }

  getApp() {
    return this.app;
  }
}

const app = new Application();

if (require.main === module) {
  app.start();
}

module.exports = app;
