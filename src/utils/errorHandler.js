const { logger } = require('./logger');

class AppError extends Error {
  constructor(message, statusCode) {
    super(message);
    this.statusCode = statusCode;
    this.status = `${statusCode}`.startsWith('4') ? 'fail' : 'error';
    this.isOperational = true;

    Error.captureStackTrace(this, this.constructor);
  }
}

const errorHandler = (err, req, res, next) => {
  err.statusCode = err.statusCode || 500;
  err.status = err.status || 'error';

  // Log error
  // Safely get IP address - handle cases where trust proxy is not set
  let clientIp = null;
  try {
    clientIp = req.ip || req.connection?.remoteAddress || req.socket?.remoteAddress;
  } catch (error) {
    // Fallback if req.ip fails (e.g., trust proxy not configured)
    clientIp = req.connection?.remoteAddress || req.socket?.remoteAddress || 'unknown';
  }
  
  logger.error('Error occurred:', {
    message: err.message,
    stack: err.stack,
    url: req.url,
    method: req.method,
    ip: clientIp,
    userAgent: req.get('User-Agent')
  });

  // Development error response
  if (process.env.NODE_ENV === 'development') {
    return res.status(err.statusCode).json({
      status: err.status,
      error: err,
      message: err.message,
      stack: err.stack
    });
  }

  // Production error response
  if (err.isOperational) {
    return res.status(err.statusCode).json({
      status: err.status,
      message: err.message
    });
  }

  // Programming or unknown errors
  return res.status(500).json({
    status: 'error',
    message: 'Something went wrong!'
  });
};

// 404 Not Found handler
const notFoundHandler = (req, res, next) => {
  const error = new AppError(`Route ${req.originalUrl} not found`, 404);
  next(error);
};

// Global error handler
const globalErrorHandler = errorHandler;

module.exports = {
  AppError,
  errorHandler,
  globalErrorHandler,
  notFoundHandler
};
