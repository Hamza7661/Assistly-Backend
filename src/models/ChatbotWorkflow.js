const mongoose = require('mongoose');
const Joi = require('joi');

// Schema for workflow options (answers/buttons)
const workflowOptionSchema = new mongoose.Schema({
  text: {
    type: String,
    required: true,
    trim: true,
    maxlength: 200
  },
  nextQuestionId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ChatbotWorkflow',
    default: null
  },
  isTerminal: {
    type: Boolean,
    default: false
  },
  order: {
    type: Number,
    default: 0
  }
}, { _id: false });

// Schema for workflow questions
const chatbotWorkflowSchema = new mongoose.Schema({
  owner: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  workflowGroupId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ChatbotWorkflow',
    default: null,
    index: true
  },
  title: {
    type: String,
    required: true,
    trim: true,
    maxlength: 200
  },
  question: {
    type: String,
    required: true,
    trim: true,
    maxlength: 500
  },
  questionType: {
    type: String,
    enum: ['single_choice', 'multiple_choice', 'text_response'],
    default: 'text_response'
  },
  options: [workflowOptionSchema],
  isRoot: {
    type: Boolean,
    default: false
  },
  isActive: {
    type: Boolean,
    default: true,
    index: true
  },
  order: {
    type: Number,
    default: 0
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
}, { timestamps: true });

// Indexes
chatbotWorkflowSchema.index({ owner: 1, isActive: 1, isRoot: 1 });
chatbotWorkflowSchema.index({ owner: 1, order: 1 });
chatbotWorkflowSchema.index({ owner: 1, workflowGroupId: 1 });

chatbotWorkflowSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

const ChatbotWorkflow = mongoose.model('ChatbotWorkflow', chatbotWorkflowSchema);

// Validation schemas
const workflowOptionValidationSchema = Joi.object({
  text: Joi.string().max(200).required(),
  nextQuestionId: Joi.string().allow(null, ''),
  isTerminal: Joi.boolean().optional(),
  order: Joi.number().optional()
});

const workflowValidationSchema = Joi.object({
  title: Joi.string().max(200).required(),
  question: Joi.string().max(500).required(),
  questionType: Joi.string().valid('single_choice', 'multiple_choice', 'text_response').default('text_response'),
  options: Joi.array().items(workflowOptionValidationSchema).default([]),
  workflowGroupId: Joi.string().allow(null, '').optional(),
  isRoot: Joi.boolean().optional(),
  isActive: Joi.boolean().optional(),
  order: Joi.number().optional()
});

const workflowUpdateValidationSchema = Joi.object({
  title: Joi.string().max(200).optional(),
  question: Joi.string().max(500).optional(),
  questionType: Joi.string().valid('single_choice', 'multiple_choice', 'text_response').default('text_response'),
  options: Joi.array().items(workflowOptionValidationSchema).default([]),
  workflowGroupId: Joi.string().allow(null, '').optional(),
  isRoot: Joi.boolean().optional(),
  isActive: Joi.boolean().optional(),
  order: Joi.number().optional()
});

const workflowReplaceArraySchema = Joi.object({
  workflows: Joi.array().items(workflowValidationSchema).required()
});

module.exports = {
  ChatbotWorkflow,
  workflowValidationSchema,
  workflowUpdateValidationSchema,
  workflowReplaceArraySchema
};
