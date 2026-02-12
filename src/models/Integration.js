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
  googleReviewEnabled: {
    type: Boolean,
    default: false
  },
  googleReviewUrl: {
    type: String,
    trim: true,
    default: null,
    maxlength: 500
  },
  /** Preferred languages for this app's chatbot (max 3). ISO 639-1 codes. Used for labels/synonyms UI. */
  preferredLanguages: {
    type: [String],
    default: undefined,
    validate: {
      validator: function (v) {
        if (!v || !Array.isArray(v)) return true;
        return v.length <= 3;
      },
      message: 'Preferred languages cannot exceed 3'
    }
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
    },
    // Optional: service plan names (treatment plan "question") to show for this lead type
    // If empty or missing, all service plans are shown
    relevantServicePlans: [{
      type: String,
      trim: true
    }],
    // Optional: alternate words/phrases (e.g. other languages) that should match this lead type
    // e.g. ["مینو", "menü", "menú"] for "Menu" so users can type in their language
    synonyms: [{
      type: String,
      trim: true,
      maxlength: 100
    }],
    // Optional: display labels per language (e.g. { ur: "مینو", hi: "मेन्यू" }) for greeting options
    labels: {
      type: Map,
      of: String,
      default: undefined
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
  googleReviewEnabled: Joi.boolean().optional(),
  googleReviewUrl: Joi.string().max(500).allow(null, '').optional(),
  preferredLanguages: Joi.array().items(Joi.string().trim().lowercase().max(10)).max(3).optional(),
  leadTypeMessages: Joi.array().items(
    Joi.object({
      id: Joi.number().integer().required(),
      value: Joi.string().required(),
      text: Joi.string().max(200).required(),
      isActive: Joi.boolean().optional().default(true),
      order: Joi.number().integer().optional().default(0),
      relevantServicePlans: Joi.array().items(Joi.string().trim()).optional(),
      synonyms: Joi.array().items(Joi.string().trim().max(100)).optional(),
      labels: Joi.object().pattern(Joi.string(), Joi.string().max(200)).optional()
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
  googleReviewEnabled: Joi.boolean().optional(),
  googleReviewUrl: Joi.string().max(500).allow(null, '').optional(),
  preferredLanguages: Joi.array().items(Joi.string().trim().lowercase().max(10)).max(3).optional(),
  leadTypeMessages: Joi.array().items(
    Joi.object({
      id: Joi.number().integer().required(),
      value: Joi.string().required(),
      text: Joi.string().max(200).required(),
      isActive: Joi.boolean().optional().default(true),
      order: Joi.number().integer().optional().default(0),
      relevantServicePlans: Joi.array().items(Joi.string().trim()).optional(),
      synonyms: Joi.array().items(Joi.string().trim().max(100)).optional(),
      labels: Joi.object().pattern(Joi.string(), Joi.string().max(200)).optional()
    })
  ).optional()
}).min(1);

const Integration = mongoose.model('Integration', integrationSchema);

module.exports = {
  Integration,
  integrationValidationSchema,
  integrationUpdateValidationSchema
};
