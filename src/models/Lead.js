const mongoose = require('mongoose');
const Joi = require('joi');
const { LEAD_TYPES_VALUES } = require('../enums/leadTypes');

const leadSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  title: { type: String, trim: true, default: null, maxlength: 200 },
  summary: { type: String, trim: true, default: null, maxlength: 500 },
  description: { type: String, trim: true, default: null, maxlength: 5000 },
  leadName: { type: String, trim: true, default: null, maxlength: 150 },
  leadPhoneNumber: { type: String, trim: true, default: null, maxlength: 50 },
  leadEmail: { type: String, trim: true, lowercase: true, default: null, maxlength: 200 },
  leadType: { type: String, default: null, index: true },
  serviceType: { type: String, default: null, index: true },
  history: [{
    role: { type: String, enum: ['user', 'assistant', 'system'], default: 'user' },
    content: { type: String, trim: true, default: null }
  }],
  leadDateTime: { type: Date, default: Date.now, index: true },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
}, { timestamps: true });

leadSchema.index({ userId: 1, createdAt: -1 });

leadSchema.pre('save', function(next) {
  const now = new Date();
  this.updatedAt = now;
  this.leadDateTime = now;
  next();
});

const Lead = mongoose.model('Lead', leadSchema);

const leadCreateSchema = Joi.object({
  title: Joi.string().max(200).allow(null, '').optional(),
  summary: Joi.string().max(500).allow(null, '').optional(),
  description: Joi.string().max(5000).allow(null, '').optional(),
  leadName: Joi.string().max(150).allow(null, '').optional(),
  leadPhoneNumber: Joi.string().max(50).allow(null, '').optional(),
  leadEmail: Joi.string().max(200).allow(null, '').custom((value, helpers) => {
    if (!value || value === '') return value; // Allow null/empty
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(value)) {
      return helpers.error('string.email');
    }
    return value;
  }).optional().messages({
    'string.email': 'Please enter a valid email address'
  }),
  leadType: Joi.string().allow(null, '').optional(),
  serviceType: Joi.string().allow(null, '').optional(),
  history: Joi.array().items(
    Joi.object({
      role: Joi.string().valid('user', 'assistant', 'system').optional(),
      content: Joi.string().allow(null, '').optional()
    })
  ).allow(null).optional()
});

const leadQuerySchema = Joi.object({
  q: Joi.string().max(200).optional(),
  leadType: Joi.string().optional(),
  serviceType: Joi.string().optional(),
  sortBy: Joi.string().valid('leadDateTime', 'createdAt', 'updatedAt', 'title').default('leadDateTime'),
  sortOrder: Joi.string().valid('asc', 'desc').default('desc'),
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20)
});

const leadUpdateSchema = Joi.object({
  title: Joi.string().max(200).allow(null, '').optional(),
  summary: Joi.string().max(500).allow(null, '').optional(),
  description: Joi.string().max(5000).allow(null, '').optional(),
  leadName: Joi.string().max(150).allow(null, '').optional(),
  leadPhoneNumber: Joi.string().max(50).allow(null, '').optional(),
  leadEmail: Joi.string().max(200).allow(null, '').custom((value, helpers) => {
    if (!value || value === '') return value; // Allow null/empty
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(value)) {
      return helpers.error('string.email');
    }
    return value;
  }).optional().messages({
    'string.email': 'Please enter a valid email address'
  }),
  leadType: Joi.string().allow(null, '').optional(),
  serviceType: Joi.string().allow(null, '').optional(),
  history: Joi.array().items(
    Joi.object({
      role: Joi.string().valid('user', 'assistant', 'system').optional(),
      content: Joi.string().allow(null, '').optional()
    })
  ).allow(null).optional()
});

module.exports = {
  Lead,
  leadCreateSchema,
  leadQuerySchema,
  leadUpdateSchema
};


