const mongoose = require('mongoose');
const Joi = require('joi');
const { INDUSTRIES } = require('../enums/industries');

const appSchema = new mongoose.Schema({
  owner: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'App owner is required'],
    index: true
  },
  name: {
    type: String,
    required: [true, 'App name is required'],
    trim: true,
    minlength: [1, 'App name cannot be empty'],
    maxlength: [100, 'App name cannot exceed 100 characters']
  },
  industry: {
    type: String,
    required: [true, 'Industry is required'],
    trim: true,
    enum: Object.values(INDUSTRIES),
    index: true
  },
  description: {
    type: String,
    trim: true,
    maxlength: [500, 'Description cannot exceed 500 characters'],
    default: ''
  },
  whatsappNumber: {
    type: String,
    trim: true,
    default: null,
    validate: {
      validator: function(v) {
        if (!v) return true; // Allow null/empty
        // E.164 format validation
        return /^\+[1-9]\d{1,14}$/.test(v);
      },
      message: 'WhatsApp number must be in E.164 format (e.g., +1234567890)'
    },
    sparse: true
  },
  whatsappNumberSource: {
    type: String,
    enum: ['user-provided', 'twilio-provided'],
    default: null
  },
  whatsappNumberStatus: {
    type: String,
    enum: ['pending', 'registered', 'failed'],
    default: null
  },
  twilioWhatsAppSenderId: {
    type: String,
    trim: true,
    default: null
  },
  isActive: {
    type: Boolean,
    default: true,
    index: true
  },
  deletedAt: {
    type: Date,
    default: null,
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

// Indexes
appSchema.index({ owner: 1 });
// Unique index only for active apps - allows reusing names from deleted apps
appSchema.index({ owner: 1, name: 1 }, { unique: true, partialFilterExpression: { isActive: true } });
appSchema.index({ whatsappNumber: 1 }, { unique: true, sparse: true });
appSchema.index({ isActive: 1 });
appSchema.index({ createdAt: -1 });

appSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

const App = mongoose.model('App', appSchema);

// Validation schemas
const appValidationSchema = Joi.object({
  name: Joi.string()
    .min(1)
    .max(100)
    .required()
    .messages({
      'string.min': 'App name cannot be empty',
      'string.max': 'App name cannot exceed 100 characters',
      'any.required': 'App name is required'
    }),
  
  industry: Joi.string()
    .valid(...Object.values(INDUSTRIES))
    .required()
    .messages({
      'any.only': 'Please select a valid industry',
      'any.required': 'Industry is required'
    }),
  
  description: Joi.string()
    .max(500)
    .allow('', null)
    .optional()
    .messages({
      'string.max': 'Description cannot exceed 500 characters'
    }),
  
  whatsappOption: Joi.string()
    .valid('use-my-number', 'get-from-twilio')
    .optional()
    .messages({
      'any.only': 'WhatsApp option must be either "use-my-number" or "get-from-twilio"'
    }),
  
  whatsappNumber: Joi.string()
    .pattern(/^\+[1-9]\d{1,14}$/)
    .optional()
    .allow(null, '')
    .messages({
      'string.pattern.base': 'WhatsApp number must be in E.164 format (e.g., +1234567890)'
    })
});

const appUpdateValidationSchema = Joi.object({
  name: Joi.string()
    .min(1)
    .max(100)
    .optional()
    .messages({
      'string.min': 'App name cannot be empty',
      'string.max': 'App name cannot exceed 100 characters'
    }),
  
  industry: Joi.string()
    .valid(...Object.values(INDUSTRIES))
    .optional()
    .messages({
      'any.only': 'Please select a valid industry'
    }),
  
  description: Joi.string()
    .max(500)
    .allow('', null)
    .optional()
    .messages({
      'string.max': 'Description cannot exceed 500 characters'
    }),
  
  whatsappNumber: Joi.string()
    .pattern(/^\+[1-9]\d{1,14}$/)
    .optional()
    .allow(null, '')
    .messages({
      'string.pattern.base': 'WhatsApp number must be in E.164 format (e.g., +1234567890)'
    }),
  
  whatsappNumberSource: Joi.string()
    .valid('user-provided', 'twilio-provided')
    .optional(),
  
  whatsappNumberStatus: Joi.string()
    .valid('pending', 'registered', 'failed')
    .optional(),
  
  twilioWhatsAppSenderId: Joi.string()
    .optional()
    .allow(null, ''),
  
  isActive: Joi.boolean()
    .optional()
}).min(1);

module.exports = {
  App,
  appValidationSchema,
  appUpdateValidationSchema
};
