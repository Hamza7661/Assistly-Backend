const mongoose = require('mongoose');
const dns = require('dns');
const { logger } = require('../utils/logger');

class DatabaseManager {
  constructor() {
    this.connection = null;
    this.isConnected = false;
    this.retryAttempts = 0;
    this.maxRetryAttempts = 5;
    this.retryDelay = 5000; // 5 seconds delay between retry attempts
  }

  getConnectionOptions() {
    return {
      maxPoolSize: parseInt(process.env.MONGODB_MAX_POOL_SIZE) || 10,
      minPoolSize: parseInt(process.env.MONGODB_MIN_POOL_SIZE) || 2,
      serverSelectionTimeoutMS: parseInt(process.env.MONGODB_SERVER_SELECTION_TIMEOUT) || 5000,
      socketTimeoutMS: parseInt(process.env.MONGODB_SOCKET_TIMEOUT) || 45000,
      maxIdleTimeMS: parseInt(process.env.MONGODB_MAX_IDLE_TIME) || 30000,
      retryWrites: true,
      w: 'majority',
      autoIndex: process.env.NODE_ENV === 'development'
    };
  }

  async connect() {
    try {
      if (this.isConnected) {
        logger.info('Database already connected');
        return this.connection;
      }

      // Configure DNS servers if specified in environment
      if (process.env.DNS_SERVERS) {
        const dnsServers = process.env.DNS_SERVERS.split(',').map(s => s.trim());
        dns.setServers(dnsServers);
        logger.info(`DNS servers configured: ${dnsServers.join(', ')}`);
      }

      const options = this.getConnectionOptions();
      let uri = process.env.MONGODB_URI;

      if (!uri) {
        throw new Error('MONGODB_URI environment variable is required');
      }

      // If using SRV connection and DNS resolution fails, try converting to standard format
      // Check if MONGODB_URI_STANDARD is provided as fallback
      const standardUri = process.env.MONGODB_URI_STANDARD;
      
      logger.info('Connecting to MongoDB...');
      
      try {
        this.connection = await mongoose.connect(uri, options);
      } catch (srvError) {
        // If SRV connection fails with DNS error and standard URI is available, try that
        if (srvError.message && (srvError.message.includes('ECONNREFUSED') || srvError.message.includes('ENOTFOUND') || srvError.message.includes('querySrv')) && standardUri) {
          logger.warn('SRV connection failed due to DNS issues, attempting standard connection string...');
          uri = standardUri;
          this.connection = await mongoose.connect(uri, options);
        } else {
          throw srvError;
        }
      }
      
      this.isConnected = true;
      this.retryAttempts = 0;

      logger.info(`✅ MongoDB connected successfully to ${this.connection.connection.host}`);
      
      this.setupEventListeners();
      return this.connection;

    } catch (error) {
      this.handleConnectionError(error);
      throw error;
    }
  }

  setupEventListeners() {
    mongoose.connection.on('error', (err) => {
      logger.error('MongoDB connection error:', err);
      this.isConnected = false;
      this.handleConnectionError(err);
    });

    mongoose.connection.on('disconnected', () => {
      logger.warn('MongoDB disconnected');
      this.isConnected = false;
    });

    mongoose.connection.on('reconnected', () => {
      logger.info('MongoDB reconnected');
      this.isConnected = false;
    });

    mongoose.connection.on('close', () => {
      logger.warn('MongoDB connection closed');
      this.isConnected = false;
    });

    process.on('SIGINT', async () => {
      await this.disconnect();
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      await this.disconnect();
      process.exit(0);
    });
  }

  async handleConnectionError(error) {
    this.retryAttempts++;
    
    if (this.retryAttempts <= this.maxRetryAttempts) {
      logger.warn(`Connection attempt ${this.retryAttempts} failed. Retrying in ${this.retryDelay}ms...`);
      
      setTimeout(async () => {
        try {
          await this.connect();
        } catch (retryError) {
          logger.error('Retry connection failed:', retryError);
        }
      }, this.retryDelay);
    } else {
      logger.error('Max retry attempts reached. Database connection failed.');
      process.exit(1);
    }
  }

  async disconnect() {
    try {
      if (this.connection && this.isConnected) {
        await mongoose.connection.close();
        this.isConnected = false;
        this.connection = null;
        logger.info('MongoDB connection closed successfully');
      }
    } catch (error) {
      logger.error('Error closing MongoDB connection:', error);
      throw error;
    }
  }

  getConnectionStatus() {
    return {
      isConnected: this.isConnected,
      host: this.connection?.connection?.host || 'Not connected',
      name: this.connection?.connection?.name || 'Not connected',
      readyState: this.connection?.connection?.readyState || 0,
      retryAttempts: this.retryAttempts
    };
  }

  async healthCheck() {
    try {
      if (!this.isConnected) {
        return { status: 'disconnected', message: 'Database not connected' };
      }

      await mongoose.connection.db.admin().ping();
      return { status: 'healthy', message: 'Database connection is healthy' };
    } catch (error) {
      logger.error('Database health check failed:', error);
      return { status: 'unhealthy', message: error.message };
    }
  }
}

const databaseManager = new DatabaseManager();

module.exports = databaseManager;
