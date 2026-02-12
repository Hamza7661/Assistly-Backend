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
    default: null,
    set: (v) => (v && typeof v === 'string' ? v.toLowerCase() : v)
  },
  twilioWhatsAppSenderId: {
    type: String,
    trim: true,
    default: null
  },
  twilioPhoneNumber: {
    type: String,
    trim: true,
    default: null,
    validate: {
      validator: function(v) {
        if (!v) return true; // Allow null/empty
        // E.164 format validation
        return /^\+[1-9]\d{1,14}$/.test(v);
      },
      message: 'Twilio phone number must be in E.164 format (e.g., +1234567890)'
    },
    index: true,
    sparse: true
  },
  /** When true, this app is the one that receives Twilio webhooks/leads for its number. Only one app per number should have this true. */
  usesTwilioNumber: {
    type: Boolean,
    default: false,
    index: true
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
appSchema.index({ whatsappNumber: 1 }, { sparse: true });
appSchema.index({ twilioPhoneNumber: 1 }, { sparse: true });
appSchema.index({ twilioPhoneNumber: 1, usesTwilioNumber: 1 }, { partialFilterExpression: { usesTwilioNumber: true }, sparse: true });
appSchema.index({ isActive: 1 });
appSchema.index({ createdAt: -1 });

appSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  if (this.whatsappNumberStatus && typeof this.whatsappNumberStatus === 'string') {
    this.whatsappNumberStatus = this.whatsappNumberStatus.toLowerCase();
  }
  // Webhook/AI context lookup uses twilioPhoneNumber or whatsappNumber; keep in sync so the app is found when messages arrive on this number
  if (this.whatsappNumber && typeof this.whatsappNumber === 'string') {
    const num = this.whatsappNumber.trim();
    if (num && !this.twilioPhoneNumber) {
      this.twilioPhoneNumber = num;
    }
  }
  next();
});

// Static methods
// Resolve app by Twilio/WhatsApp number: among apps that have this number, return the one with usesTwilioNumber true (leads/flows use that app). Falls back to any app with this number if none flagged.
appSchema.statics.findByTwilioPhone = function(twilioPhoneNumber) {
  const normalized = twilioPhoneNumber && String(twilioPhoneNumber).trim();
  if (!normalized) return this.findOne({ _id: null });
  const baseQuery = {
    $and: [
      { $or: [ { twilioPhoneNumber: normalized }, { whatsappNumber: normalized } ] },
      { isActive: true },
      { $or: [ { deletedAt: null }, { deletedAt: { $exists: false } } ] }
    ]
  };
  return this.findOne(baseQuery).sort({ usesTwilioNumber: -1 }); // prefer usesTwilioNumber true
};

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
    }),
  
  twilioPhoneNumber: Joi.string()
    .pattern(/^\+[1-9]\d{1,14}$/)
    .optional()
    .allow(null, '')
    .messages({
      'string.pattern.base': 'Twilio phone number must be in E.164 format (e.g., +1234567890)'
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
  
  twilioPhoneNumber: Joi.string()
    .pattern(/^\+[1-9]\d{1,14}$/)
    .optional()
    .allow(null, '')
    .messages({
      'string.pattern.base': 'Twilio phone number must be in E.164 format (e.g., +1234567890)'
    }),
  
  usesTwilioNumber: Joi.boolean()
    .optional(),
  
  isActive: Joi.boolean()
    .optional()
}).min(1);

module.exports = {
  App,
  appValidationSchema,
  appUpdateValidationSchema
};
