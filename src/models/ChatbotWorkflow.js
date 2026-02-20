const mongoose = require('mongoose');
const Joi = require('joi');

// Sub-schema for branching options (multiple-choice with scenario linking)
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
}, { _id: true });

// Schema for workflow questions
const chatbotWorkflowSchema = new mongoose.Schema({
  owner: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'App',
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
  questionTypeId: {
    type: Number,
    required: true,
    default: 1 
  },
  // Multiple-choice options with optional branching to different next questions
  options: {
    type: [workflowOptionSchema],
    default: []
  },
  // File attachment: admin-uploaded PDF/document that the bot will offer for download
  attachment: {
    hasFile: { type: Boolean, default: false },
    data: { type: Buffer, default: null },
    contentType: { type: String, default: null },
    filename: { type: String, default: null },
    size: { type: Number, default: null }
  },
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
  _id: Joi.string().optional(),
  text: Joi.string().max(200).required(),
  nextQuestionId: Joi.string().allow(null, '').optional(),
  isTerminal: Joi.boolean().optional(),
  order: Joi.number().optional()
});

const workflowValidationSchema = Joi.object({
  title: Joi.string().max(200).required(),
  question: Joi.string().max(500).required(),
  questionTypeId: Joi.number().integer().min(1).default(1), 
  workflowGroupId: Joi.string().allow(null, '').optional(),
  options: Joi.array().items(workflowOptionValidationSchema).optional(),
  isRoot: Joi.boolean().optional(),
  isActive: Joi.boolean().optional(),
  order: Joi.number().optional()
});

const workflowUpdateValidationSchema = Joi.object({
  title: Joi.string().max(200).optional(),
  question: Joi.string().max(500).optional(),
  questionTypeId: Joi.number().integer().min(1).optional(),
  workflowGroupId: Joi.string().allow(null, '').optional(),
  options: Joi.array().items(workflowOptionValidationSchema).optional(),
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
