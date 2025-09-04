const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const slowDown = require('express-slow-down');
const mongoSanitize = require('express-mongo-sanitize');
const hpp = require('hpp');
const xss = require('xss');
const compression = require('compression');
const express = require('express');

class SecurityMiddleware {
  constructor() {
    this.setupRateLimiters();
    this.setupSlowDown();
  }

  setupRateLimiters() {
    // Global rate limiter: 100 requests per 15 minutes (15 * 60 * 1000 = 900,000ms = 15 minutes)
    this.globalLimiter = rateLimit({
      windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000, // 15 minutes in milliseconds
      max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,
      message: {
        status: 'error',
        message: 'Too many requests from this IP, please try again later.',
        retryAfter: Math.ceil((parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000) / 1000)
      },
      standardHeaders: true,
      legacyHeaders: false,
      skipSuccessfulRequests: false,
      keyGenerator: rateLimit.ipKeyGenerator,
      handler: (req, res) => {
        res.status(429).json({
          status: 'error',
          message: 'Too many requests, please try again later.',
          retryAfter: Math.ceil((parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000) / 1000)
        });
      }
    });

    // Authentication rate limiter: 5 attempts per 15 minutes (15 * 60 * 1000 = 900,000ms = 15 minutes)
    this.authLimiter = rateLimit({
      windowMs: parseInt(process.env.AUTH_RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000, // 15 minutes in milliseconds
      max: parseInt(process.env.AUTH_RATE_LIMIT_MAX) || 5,
      skipSuccessfulRequests: true,
      message: {
        status: 'error',
        message: 'Too many authentication attempts, please try again later.',
        retryAfter: Math.ceil((parseInt(process.env.AUTH_RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000) / 1000)
      }
    });

    // Signup rate limiter: 3 attempts per hour (60 * 60 * 1000 = 3,600,000ms = 1 hour)
    this.signupLimiter = rateLimit({
      windowMs: parseInt(process.env.SIGNUP_RATE_LIMIT_WINDOW_MS) || 60 * 60 * 1000, // 1 hour in milliseconds
      max: parseInt(process.env.SIGNUP_RATE_LIMIT_MAX) || 3,
      message: {
        status: 'error',
        message: 'Too many signup attempts, please try again later.',
        retryAfter: Math.ceil((parseInt(process.env.SIGNUP_RATE_LIMIT_WINDOW_MS) || 60 * 60 * 1000) / 1000)
      }
    });

    // API rate limiter: 200 requests per 15 minutes (15 * 60 * 1000 = 900,000ms = 15 minutes)
    this.apiLimiter = rateLimit({
      windowMs: 15 * 60 * 1000, // 15 minutes in milliseconds
      max: 200,
      skipSuccessfulRequests: true,
      message: {
        status: 'error',
        message: 'API rate limit exceeded, please try again later.'
      }
    });
  }

  setupSlowDown() {
    // Slow down requests after 50 requests in 15 minutes: 500ms delay, max 20 seconds
    this.slowDown = slowDown({
      windowMs: 15 * 60 * 1000, // 15 minutes in milliseconds
      delayAfter: 50, // Start delaying after 50 requests
      delayMs: () => 500, // 500ms delay per request
      maxDelayMs: 20000, // Maximum delay: 20 seconds
      skipSuccessfulRequests: true,
      keyGenerator: rateLimit.ipKeyGenerator
    });
  }

  getHelmetConfig() {
    return helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
          scriptSrc: ["'self'", "https://cdn.jsdelivr.net"],
          imgSrc: ["'self'", "data:", "https:", "blob:"],
          fontSrc: ["'self'", "https://fonts.gstatic.com"],
          connectSrc: ["'self'"],
          mediaSrc: ["'self'"],
          objectSrc: ["'none'"],
          frameSrc: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
          upgradeInsecureRequests: []
        }
      },
      crossOriginEmbedderPolicy: false,
      crossOriginResourcePolicy: { policy: "cross-origin" },
      dnsPrefetchControl: { allow: false },
      frameguard: { action: "deny" },
      hidePoweredBy: true,
      hsts: {
        maxAge: 31536000, // 1 year in seconds (365 * 24 * 60 * 60 = 31,536,000)
        includeSubDomains: true,
        preload: true
      },
      ieNoOpen: true,
      noSniff: true,
      permittedCrossDomainPolicies: { permittedPolicies: "none" },
      referrerPolicy: { policy: "strict-origin-when-cross-origin" },
      xssFilter: true
    });
  }

  getCorsConfig() {
    const allowedOrigins = process.env.ALLOWED_ORIGINS ? 
      process.env.ALLOWED_ORIGINS.split(',') : 
      ['http://localhost:3000', 'http://localhost:3001'];

    const allowedMethods = process.env.ALLOWED_METHODS ? 
      process.env.ALLOWED_METHODS.split(',') : 
      ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'];

    const allowedHeaders = process.env.ALLOWED_HEADERS ? 
      process.env.ALLOWED_HEADERS.split(',') : 
      ['Content-Type', 'Authorization', 'X-Requested-With', 'X-API-Key'];

    return cors({
      origin: (origin, callback) => {
        if (!origin || allowedOrigins.includes(origin)) {
          callback(null, true);
        } else {
          callback(new Error('Not allowed by CORS'));
        }
      },
      methods: allowedMethods,
      allowedHeaders: allowedHeaders,
      credentials: true,
      maxAge: 86400, // 24 hours in seconds (24 * 60 * 60 = 86,400)
      preflightContinue: false,
      optionsSuccessStatus: 204
    });
  }

  getMongoSanitizeConfig() {
    return mongoSanitize({
      replaceWith: '_',
      onSanitize: ({ req, key }) => {
        console.warn(`Sanitized key: ${key} in request:`, req.url);
      }
    });
  }

  getHppConfig() {
    return hpp({
      whitelist: ['filter', 'sort', 'page', 'limit']
    });
  }

  getCompressionConfig() {
    return compression({
      level: 6,
      threshold: 1024,
      filter: (req, res) => {
        if (req.headers['x-no-compression']) {
          return false;
        }
        return compression.filter(req, res);
      }
    });
  }

  applySecurityMiddleware(app) {
    app.use(this.getHelmetConfig());
    app.use(this.getCorsConfig());
    app.use(this.getCompressionConfig());
    app.use(this.globalLimiter);
    app.use(this.slowDown);
    app.use(this.getMongoSanitizeConfig());
    app.use(this.getHppConfig());
    app.use((req, res, next) => {
      if (req.body) {
        Object.keys(req.body).forEach(key => {
          if (typeof req.body[key] === 'string') {
            req.body[key] = xss(req.body[key]);
          }
        });
      }
      next();
    });
    
    app.use(express.json({ 
      limit: process.env.MAX_FILE_SIZE || '10mb',
      verify: (req, res, buf) => {
        req.rawBody = buf;
      }
    }));
    
    app.use(express.urlencoded({ 
      extended: true, 
      limit: process.env.MAX_FILE_SIZE || '10mb' 
    }));

    app.use((req, res, next) => {
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('X-Frame-Options', 'DENY');
      res.setHeader('X-XSS-Protection', '1; mode=block');
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
      res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
      next();
    });
  }

  getRateLimiters() {
    return {
      global: this.globalLimiter,
      auth: this.authLimiter,
      signup: this.signupLimiter,
      api: this.apiLimiter
    };
  }
}

module.exports = new SecurityMiddleware();
