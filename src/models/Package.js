const mongoose = require('mongoose');
const Joi = require('joi');
const { PACKAGE_TYPES, PACKAGE_BILLING_CYCLES, PACKAGE_CURRENCIES } = require('../enums/packageTypes');

const packageSchema = new mongoose.Schema({
  id: {
    type: Number,
    required: true,
    min: 1
  },
  name: {
    type: String,
    required: true,
    trim: true,
    unique: true
  },
  type: {
    type: String,
    required: true,
    enum: Object.values(PACKAGE_TYPES),
    default: PACKAGE_TYPES.BASIC
  },
  isCustom: {
    type: Boolean,
    default: false
  },
  price: {
    amount: {
      type: Number,
      required: true,
      min: 0,
      default: 0
    },
    currency: {
      type: String,
      required: true,
      enum: Object.values(PACKAGE_CURRENCIES),
      default: PACKAGE_CURRENCIES.USD
    },
    billingCycle: {
      type: String,
      required: true,
      enum: Object.values(PACKAGE_BILLING_CYCLES),
      default: PACKAGE_BILLING_CYCLES.MONTHLY
    }
  },
  limits: {
    chatbotQueries: {
      type: Number,
      required: true,
      min: -1,
      default: 0
    },
    voiceMinutes: {
      type: Number,
      required: true,
      min: -1,
      default: 0
    },
    leadGeneration: {
      type: Number,
      required: true,
      min: -1,
      default: 0
    }
  },
  features: {
    chatbot: {
      type: Boolean,
      default: false
    },
    voiceAgent: {
      type: Boolean,
      default: false
    },
    leadGeneration: {
      type: Boolean,
      default: false
    }
  },
  description: {
    type: String,
    required: true,
    trim: true
  },
  isActive: {
    type: Boolean,
    default: true
  },
  isPopular: {
    type: Boolean,
    default: false
  },
  sortOrder: {
    type: Number,
    default: 0
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
  timestamps: true,
  toJSON: { 
    virtuals: true,
    transform: function(doc, ret) {
      ret.price.formatted = `${ret.price.currency} ${ret.price.amount}`;
              ret.limits.formatted = {
          chatbotQueries: ret.limits.chatbotQueries === -1 ? 'Unlimited' : `${ret.limits.chatbotQueries} queries`,
          voiceMinutes: ret.limits.voiceMinutes === -1 ? 'Unlimited' : `${ret.limits.voiceMinutes} minutes`,
          leadGeneration: ret.limits.leadGeneration === -1 ? 'Unlimited' : `${ret.limits.leadGeneration} contacts`
        };
      return ret;
    }
  }
});

// Virtual for checking if package is unlimited
packageSchema.virtual('isUnlimited').get(function() {
  return this.limits.chatbotQueries === -1 && this.limits.voiceMinutes === -1;
});

// Virtual for checking if package is free
packageSchema.virtual('isFree').get(function() {
  return this.price.amount === 0;
});

// Indexes for better query performance
packageSchema.index({ id: 1 }, { unique: true });
packageSchema.index({ type: 1 });
packageSchema.index({ isActive: 1 });
packageSchema.index({ sortOrder: 1 });
packageSchema.index({ 'price.amount': 1 });

// Pre-save middleware to update timestamp
packageSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

// Static method to get all active packages
packageSchema.statics.getActivePackages = function() {
  return this.find({ isActive: true }).sort({ sortOrder: 1, id: 1 });
};

// Static method to get package by ID
packageSchema.statics.getById = function(id) {
  return this.findOne({ id: id, isActive: true });
};

// Static method to get package by type
packageSchema.statics.getByType = function(type) {
  return this.findOne({ type: type, isActive: true });
};

// Static method to get popular packages
packageSchema.statics.getPopularPackages = function() {
  return this.find({ isPopular: true, isActive: true }).sort({ sortOrder: 1 });
};

const Package = mongoose.model('Package', packageSchema);

// Validation schemas
const packageValidationSchema = Joi.object({
  id: Joi.number().integer().min(1).required(),
  name: Joi.string().min(1).max(100).required(),
  type: Joi.string().valid(...Object.values(PACKAGE_TYPES)).required(),
  isCustom: Joi.boolean().default(false),
  price: Joi.object({
    amount: Joi.number().min(0).required(),
    currency: Joi.string().valid(...Object.values(PACKAGE_CURRENCIES)).default(PACKAGE_CURRENCIES.USD),
    billingCycle: Joi.string().valid(...Object.values(PACKAGE_BILLING_CYCLES)).default(PACKAGE_BILLING_CYCLES.MONTHLY)
  }).required(),
  limits: Joi.object({
    chatbotQueries: Joi.number().min(-1).required(),
    voiceMinutes: Joi.number().min(-1).default(0),
    leadGeneration: Joi.number().min(-1).default(0)
  }).required(),
  features: Joi.object({
    chatbot: Joi.boolean().default(false),
    voiceAgent: Joi.boolean().default(false),
    leadGeneration: Joi.boolean().default(false)
  }).default({}),
  description: Joi.string().min(1).max(500).required(),
  isActive: Joi.boolean().default(true),
  isPopular: Joi.boolean().default(false),
  sortOrder: Joi.number().integer().min(0).default(0)
});

const packageUpdateValidationSchema = Joi.object({
  name: Joi.string().min(1).max(100),
  isCustom: Joi.boolean(),
  price: Joi.object({
    amount: Joi.number().min(0),
    currency: Joi.string().valid(...Object.values(PACKAGE_CURRENCIES)),
    billingCycle: Joi.string().valid(...Object.values(PACKAGE_BILLING_CYCLES))
  }),
  limits: Joi.object({
    chatbotQueries: Joi.number().min(-1),
    voiceMinutes: Joi.number().min(-1),
    leadGeneration: Joi.number().min(-1)
  }),
  features: Joi.object({
    chatbot: Joi.boolean(),
    voiceAgent: Joi.boolean(),
    leadGeneration: Joi.boolean()
  }),
  description: Joi.string().min(1).max(500),
  isActive: Joi.boolean(),
  isPopular: Joi.boolean(),
  sortOrder: Joi.number().integer().min(0)
});

const customPackageValidationSchema = Joi.object({
  type: Joi.string().valid(PACKAGE_TYPES.CUSTOM).required(),
  price: Joi.object({
    amount: Joi.number().min(0).required(),
    currency: Joi.string().valid(...Object.values(PACKAGE_CURRENCIES)).default(PACKAGE_CURRENCIES.USD),
    billingCycle: Joi.string().valid(...Object.values(PACKAGE_BILLING_CYCLES)).default(PACKAGE_BILLING_CYCLES.MONTHLY)
  }).required(),
  limits: Joi.object({
    chatbotQueries: Joi.number().min(-1).required(),
    voiceMinutes: Joi.number().min(-1).default(0),
    leadGeneration: Joi.number().min(-1).default(0)
  }).required(),
  features: Joi.object({
    chatbot: Joi.boolean().default(false),
    voiceAgent: Joi.boolean().default(false),
    leadGeneration: Joi.boolean().default(false)
  }).default({}),
  description: Joi.string().min(1).max(500).optional()
}).unknown(true);

module.exports = {
  Package,
  packageValidationSchema,
  packageUpdateValidationSchema,
  customPackageValidationSchema
};
