const redis = require('redis');
const { logger } = require('./logger');

class CacheManager {
  constructor() {
    this.client = null;
    this.isConnected = false;
  }

  async connect() {
    try {
      // Only try to connect if REDIS_URL is explicitly set
      if (!process.env.REDIS_URL) {
        logger.info('Redis URL not configured, caching disabled');
        this.isConnected = false;
        return;
      }

      const redisUrl = process.env.REDIS_URL;
      
      this.client = redis.createClient({
        url: redisUrl,
        socket: {
          connectTimeout: 5000,
          lazyConnect: true
        }
      });

      this.client.on('error', (err) => {
        logger.warn('Redis client error:', err.message);
        this.isConnected = false;
      });

      this.client.on('connect', () => {
        logger.info('Redis client connected');
        this.isConnected = true;
      });

      this.client.on('ready', () => {
        logger.info('Redis client ready');
        this.isConnected = true;
      });

      this.client.on('end', () => {
        logger.warn('Redis client disconnected');
        this.isConnected = false;
      });

      // Try to connect with timeout
      await Promise.race([
        this.client.connect(),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Redis connection timeout')), 5000)
        )
      ]);
    } catch (error) {
      logger.warn('Redis connection failed, caching disabled:', error.message);
      this.isConnected = false;
      this.client = null;
    }
  }

  async disconnect() {
    if (this.client && this.isConnected) {
      await this.client.quit();
      this.isConnected = false;
    }
  }

  async get(key) {
    if (!this.isConnected || !this.client) {
      return null;
    }

    try {
      const value = await this.client.get(key);
      return value ? JSON.parse(value) : null;
    } catch (error) {
      logger.error('Cache get error:', error.message);
      return null;
    }
  }

  async set(key, value, ttlSeconds = 300) { // Default 5 minutes
    if (!this.isConnected || !this.client) {
      return false;
    }

    try {
      await this.client.setEx(key, ttlSeconds, JSON.stringify(value));
      return true;
    } catch (error) {
      logger.error('Cache set error:', error.message);
      return false;
    }
  }

  async del(key) {
    if (!this.isConnected || !this.client) {
      return false;
    }

    try {
      await this.client.del(key);
      return true;
    } catch (error) {
      logger.error('Cache delete error:', error.message);
      return false;
    }
  }

  async invalidateUserContext(userId) {
    const keys = [
      `user_context:${userId}`,
      `user_integration:${userId}`,
      `user_questionnaire:${userId}`,
      `user_profile:${userId}`
    ];

    for (const key of keys) {
      await this.del(key);
    }
  }

  // Generate cache key for user context
  getUserContextKey(userId) {
    return `user_context:${userId}`;
  }

  // Generate cache key for app context (widget/WebSocket by app_id)
  getAppContextKey(appId) {
    return `app_context:${appId}`;
  }

  // Generate cache key for integration
  getIntegrationKey(userId) {
    return `user_integration:${userId}`;
  }
}

const cacheManager = new CacheManager();

module.exports = cacheManager;
