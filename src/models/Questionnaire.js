const mongoose = require('mongoose');
const Joi = require('joi');
const { QUESTIONNAIRE_TYPES } = require('../enums/questionnaireTypes');

const questionnaireSchema = new mongoose.Schema({
  owner: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'App',
    required: true,
    index: true
  },
  type: {
    type: Number,
    required: true,
    enum: Object.values(QUESTIONNAIRE_TYPES),
    default: QUESTIONNAIRE_TYPES.FAQ,
    index: true
  },
  question: {
    type: String,
    required: true,
    trim: true,
    minlength: 3,
    maxlength: 500
  },
  answer: {
    type: String,
    required: true,
    trim: true,
    minlength: 1,
    maxlength: 10000
  },
  // For treatment plans: attached workflow IDs with ordering
  attachedWorkflows: [{
    workflowId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ChatbotWorkflow'
    },
    order: {
      type: Number,
      default: 0
    }
  }],
  isActive: {
    type: Boolean,
    default: true,
    index: true
  },
  createdAt: {
    type: Date,
    default: Date.now,
    immutable: true
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

questionnaireSchema.index({ owner: 1, type: 1, isActive: 1, updatedAt: -1 });
questionnaireSchema.index({ question: 'text', answer: 'text' });

questionnaireSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

const Questionnaire = mongoose.model('Questionnaire', questionnaireSchema);

const questionnaireValidationSchema = Joi.object({
  type: Joi.number().valid(...Object.values(QUESTIONNAIRE_TYPES)).required(),
  question: Joi.string().min(3).max(500).required(),
  answer: Joi.string().min(1).max(10000).required(),
  isActive: Joi.boolean().optional()
});

const questionnaireUpdateValidationSchema = Joi.object({
  type: Joi.number().valid(...Object.values(QUESTIONNAIRE_TYPES)),
  question: Joi.string().min(3).max(500),
  answer: Joi.string().min(1).max(10000),
  isActive: Joi.boolean()
});

const questionnaireArraySchema = Joi.object({
  type: Joi.number().valid(...Object.values(QUESTIONNAIRE_TYPES)).required(),
  items: Joi.array().items(
    Joi.object({
      question: Joi.string().min(3).max(500).required(),
      answer: Joi.string().min(1).max(10000).required(),
      attachedWorkflows: Joi.array().items(
        Joi.object({
          workflowId: Joi.string().allow(null, ''),
          order: Joi.number().default(0)
        })
      ).optional()
    })
  ).required()
});

module.exports = {
  Questionnaire,
  questionnaireValidationSchema,
  questionnaireUpdateValidationSchema,
  questionnaireArraySchema,
  QUESTIONNAIRE_TYPES
};


