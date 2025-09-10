const multer = require('multer');
const { logger } = require('../utils/logger');
const { AppError } = require('../utils/errorHandler');

// Configure multer for memory storage (to store in MongoDB as Buffer)
const storage = multer.memoryStorage();

// File filter for images only
const fileFilter = (req, file, cb) => {
  // Check if file is an image
  if (file.mimetype.startsWith('image/')) {
    // Check for specific image types
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

// Configure multer
const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: parseInt(process.env.MAX_FILE_SIZE) || 10 * 1024 * 1024, // 10MB default
    files: 1 // Only allow 1 file
  }
});

// Middleware for single file upload
const uploadSingle = (fieldName) => {
  return (req, res, next) => {
    const uploadHandler = upload.single(fieldName);
    
    uploadHandler(req, res, (err) => {
      if (err) {
        if (err instanceof multer.MulterError) {
          if (err.code === 'LIMIT_FILE_SIZE') {
            return next(new AppError('File too large. Maximum size is 10MB', 400));
          }
          if (err.code === 'LIMIT_FILE_COUNT') {
            return next(new AppError('Too many files. Only 1 file allowed', 400));
          }
          if (err.code === 'LIMIT_UNEXPECTED_FILE') {
            return next(new AppError(`Unexpected field. Expected field name: ${fieldName}`, 400));
          }
        }
        return next(err);
      }
      next();
    });
  };
};

module.exports = {
  uploadSingle
};
