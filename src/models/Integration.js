const mongoose = require('mongoose');
const Joi = require('joi');
const { LEAD_TYPES_LIST } = require('../enums/leadTypes');

const integrationSchema = new mongoose.Schema({
  owner: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'App',
    required: true,
    index: true
  },
  chatbotImage: {
    data: {
      type: Buffer,
      default: null
    },
    contentType: {
      type: String,
      default: null,
      validate: {
        validator: function(v) {
          if (!v) return true; // Allow null/empty
          return /^image\/(jpeg|jpg|png|gif|webp)$/i.test(v);
        },
        message: 'Content type must be a valid image format (jpeg, jpg, png, gif, webp)'
      }
    },
    filename: {
      type: String,
      default: null,
      maxlength: 255
    }
  },
  assistantName: {
    type: String,
    default: 'Assistant',
    maxlength: 50,
    trim: true
  },
  companyName: {
    type: String,
    default: '',
    maxlength: 100,
    trim: true
  },
  greeting: {
    type: String,
    default: process.env.DEFAULT_GREETING || 'Hi this is {assistantName} your virtual ai assistant from {companyName}. How can I help you today?',
    maxlength: 500,
    trim: true
  },
  primaryColor: {
    type: String,
    default: process.env.DEFAULT_PRIMARY_COLOR || '#3B82F6',
    validate: {
      validator: function(v) {
        if (!v || v === '') return true; // Allow empty strings
        return /^#[0-9A-Fa-f]{6}$/.test(v);
      },
      message: 'Primary color must be a valid hex color (e.g., #3B82F6) or empty'
    }
  },
  validateEmail: {
    type: Boolean,
    default: true
  },
  validatePhoneNumber: {
    type: Boolean,
    default: true
  },
  leadTypeMessages: [{
    id: {
      type: Number,
      required: true
    },
    value: {
      type: String,
      required: true,
      trim: true
    },
    text: {
      type: String,
      required: true,
      trim: true,
      maxlength: [200, 'Lead type text cannot exceed 200 characters']
    },
    isActive: {
      type: Boolean,
      default: true
    },
    order: {
      type: Number,
      default: 0
    }
  }]
}, {
  timestamps: true
});

// Ensure one integration per app
integrationSchema.index({ owner: 1 }, { unique: true });

// Set default leadTypeMessages if not provided
integrationSchema.pre('save', function(next) {
  if (!this.leadTypeMessages || this.leadTypeMessages.length === 0) {
    this.leadTypeMessages = LEAD_TYPES_LIST.map((lt, index) => ({
      id: lt.id,
      value: lt.value,
      text: lt.text,
      isActive: true,
      order: index
    }));
  }
  next();
});

// Joi validation schemas
const integrationValidationSchema = Joi.object({
  assistantName: Joi.string().max(50).allow('', null).optional(),
  companyName: Joi.string().max(100).allow('', null).optional(),
  greeting: Joi.string().max(500).allow('', null).optional(),
  primaryColor: Joi.string().allow('', null).custom((value, helpers) => {
    if (!value || value === '') return value; // Allow empty strings
    if (/^#[0-9A-Fa-f]{6}$/.test(value)) return value; // Valid hex color
    return helpers.error('string.pattern.base');
  }).optional().messages({
    'string.pattern.base': 'Primary color must be a valid hex color (e.g., #3B82F6) or empty'
  }),
  validateEmail: Joi.boolean().optional(),
  validatePhoneNumber: Joi.boolean().optional(),
  leadTypeMessages: Joi.array().items(
    Joi.object({
      id: Joi.number().integer().required(),
      value: Joi.string().required(),
      text: Joi.string().max(200).required(),
      isActive: Joi.boolean().optional().default(true),
      order: Joi.number().integer().optional().default(0)
    })
  ).optional()
});

const integrationUpdateValidationSchema = Joi.object({
  assistantName: Joi.string().max(50).allow('', null).optional(),
  companyName: Joi.string().max(100).allow('', null).optional(),
  greeting: Joi.string().max(500).allow('', null).optional(),
  primaryColor: Joi.string().allow('', null).custom((value, helpers) => {
    if (!value || value === '') return value; // Allow empty strings
    if (/^#[0-9A-Fa-f]{6}$/.test(value)) return value; // Valid hex color
    return helpers.error('string.pattern.base');
  }).optional().messages({
    'string.pattern.base': 'Primary color must be a valid hex color (e.g., #3B82F6) or empty'
  }),
  validateEmail: Joi.boolean().optional(),
  validatePhoneNumber: Joi.boolean().optional(),
  leadTypeMessages: Joi.array().items(
    Joi.object({
      id: Joi.number().integer().required(),
      value: Joi.string().required(),
      text: Joi.string().max(200).required(),
      isActive: Joi.boolean().optional().default(true),
      order: Joi.number().integer().optional().default(0)
    })
  ).optional()
}).min(1);

const Integration = mongoose.model('Integration', integrationSchema);

module.exports = {
  Integration,
  integrationValidationSchema,
  integrationUpdateValidationSchema
};
