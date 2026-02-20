const multer = require('multer');
const { logger } = require('../utils/logger');
const { AppError } = require('../utils/errorHandler');

// Configure multer for memory storage (to store in MongoDB as Buffer)
const storage = multer.memoryStorage();

// File filter for images only
const imageFileFilter = (req, file, cb) => {
  if (file.mimetype.startsWith('image/')) {
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new AppError('Only JPEG, PNG, GIF, and WebP images are allowed', 400), false);
    }
  } else {
    cb(new AppError('Only image files are allowed', 400), false);
  }
};

// File filter for documents (PDF, Word, etc.) and images
const documentFileFilter = (req, file, cb) => {
  const allowedTypes = [
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/plain',
    'image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'
  ];
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new AppError('Only PDF, Word, Excel, text files and images are allowed', 400), false);
  }
};

// Configure multer for images
const uploadImage = multer({
  storage: storage,
  fileFilter: imageFileFilter,
  limits: {
    fileSize: parseInt(process.env.MAX_FILE_SIZE) || 10 * 1024 * 1024,
    files: 1
  }
});

// Configure multer for documents
const uploadDocument = multer({
  storage: storage,
  fileFilter: documentFileFilter,
  limits: {
    fileSize: parseInt(process.env.MAX_DOCUMENT_SIZE) || 25 * 1024 * 1024, // 25MB for documents
    files: 1
  }
});

const _handleMulterError = (err, fieldName, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return next(new AppError('File too large. Maximum size exceeded', 400));
    }
    if (err.code === 'LIMIT_FILE_COUNT') {
      return next(new AppError('Too many files. Only 1 file allowed', 400));
    }
    if (err.code === 'LIMIT_UNEXPECTED_FILE') {
      return next(new AppError(`Unexpected field. Expected field name: ${fieldName}`, 400));
    }
  }
  return next(err);
};

// Middleware for single image upload
const uploadSingle = (fieldName) => {
  return (req, res, next) => {
    const uploadHandler = uploadImage.single(fieldName);
    uploadHandler(req, res, (err) => {
      if (err) return _handleMulterError(err, fieldName, next);
      next();
    });
  };
};

// Middleware for single document upload (PDF, Word, etc.)
const uploadDocumentSingle = (fieldName) => {
  return (req, res, next) => {
    const uploadHandler = uploadDocument.single(fieldName);
    uploadHandler(req, res, (err) => {
      if (err) return _handleMulterError(err, fieldName, next);
      next();
    });
  };
};

module.exports = {
  uploadSingle,
  uploadDocumentSingle
};
