const express = require('express');
const { QuestionType } = require('../models/QuestionType');
const { AppError } = require('../utils/errorHandler');
const { logger } = require('../utils/logger');

const router = express.Router();

// Public: list question types with ids, codes, and values from database
router.get('/', async (req, res, next) => {
  try {
    const questionTypes = await QuestionType.find({ isActive: true })
      .select('id code value')
      .sort({ id: 1 })
      .lean();

    res.status(200).json({
      status: 'success',
      data: {
        questionTypes
      }
    });
  } catch (error) {
    logger.error('Error fetching question types:', error);
    next(new AppError('Failed to fetch question types', 500));
  }
});

module.exports = router;

