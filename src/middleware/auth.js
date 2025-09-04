const jwt = require('jsonwebtoken');
const { AppError } = require('../utils/errorHandler');
const { logger } = require('../utils/logger');

// Middleware to verify JWT token
const authenticateToken = (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (!token) {
      throw new AppError('Access token is required', 401);
    }

    jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
      if (err) {
        if (err.name === 'TokenExpiredError') {
          throw new AppError('Token has expired', 401);
        } else if (err.name === 'JsonWebTokenError') {
          throw new AppError('Invalid token', 401);
        } else {
          throw new AppError('Token verification failed', 401);
        }
      }

      // Add user info to request
      req.user = {
        id: decoded.userId || decoded.id, // Support both userId and id for backward compatibility
        email: decoded.email,
        role: decoded.role || 'user'
      };

      logger.info(`User authenticated: ${req.user.email} (ID: ${req.user.id})`);
      next();
    });

  } catch (error) {
    next(error);
  }
};

// Optional authentication - doesn't fail if no token
const optionalAuth = (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (token) {
      jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
        if (!err) {
          req.user = {
            id: decoded.userId || decoded.id, // Support both userId and id for backward compatibility
            email: decoded.email,
            role: decoded.role || 'user'
          };
          logger.info(`Optional auth successful: ${req.user.email}`);
        }
        next();
      });
    } else {
      next();
    }

  } catch (error) {
    next();
  }
};

// Role-based access control
const requireRole = (roles) => {
  return (req, res, next) => {
    try {
      if (!req.user) {
        throw new AppError('Authentication required', 401);
      }

      if (!roles.includes(req.user.role)) {
        throw new AppError('Insufficient permissions', 403);
      }

      logger.info(`Role check passed: ${req.user.email} has role ${req.user.role}`);
      next();

    } catch (error) {
      next(error);
    }
  };
};

// Admin only access
const requireAdmin = requireRole(['admin']);

// User or admin access
const requireUserOrAdmin = requireRole(['user', 'admin']);

module.exports = {
  authenticateToken,
  optionalAuth,
  requireRole,
  requireAdmin,
  requireUserOrAdmin
};
