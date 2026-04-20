require('dotenv').config();

const databaseManager = require('../config/database');
const cacheManager = require('../utils/cache');
const emailOrchestratorService = require('../services/emailOrchestratorService');
const { logger } = require('../utils/logger');

async function start() {
  try {
    await databaseManager.connect();
    await cacheManager.connect();
    await emailOrchestratorService.startWorker();
    logger.info('Email worker service started');
  } catch (error) {
    logger.error('Email worker failed to start', { error: error.message });
    process.exit(1);
  }
}

async function shutdown(signal) {
  logger.info(`Email worker received ${signal}, shutting down...`);
  try {
    await emailOrchestratorService.stopWorker();
    await cacheManager.disconnect();
    await databaseManager.disconnect();
    process.exit(0);
  } catch (error) {
    logger.error('Email worker shutdown failed', { error: error.message });
    process.exit(1);
  }
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

start();
