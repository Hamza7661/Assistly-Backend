const mongoose = require('mongoose');
const Joi = require('joi');
const { LEAD_TYPES_VALUES } = require('../enums/leadTypes');

const leadSchema = new mongoose.Schema({
  appId: { type: mongoose.Schema.Types.ObjectId, ref: 'App', required: false, index: true }, // Required for new leads, optional for migration
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: false, index: true }, // Legacy support (still used by some routes/scripts)
  title: { type: String, trim: true, default: null, maxlength: 200 },
  summary: { type: String, trim: true, default: null, maxlength: 500 },
  description: { type: String, trim: true, default: null, maxlength: 5000 },
  leadName: { type: String, trim: true, default: null, maxlength: 150 },
  leadPhoneNumber: { type: String, trim: true, default: null, maxlength: 50 },
  leadEmail: { type: String, trim: true, lowercase: true, default: null, maxlength: 200 },
  leadType: { type: String, default: null, index: true },
  serviceType: { type: String, default: null, index: true },
  sourceChannel: { type: String, default: null, index: true },
  status: { type: String, enum: ['interacting', 'in_progress', 'complete', 'confirmed'], default: 'interacting', index: true },
  location: {
    country: { type: String, trim: true, default: null },
    countryCode: { type: String, trim: true, default: null }
  },
  clientContext: {
    ipAddress: { type: String, trim: true, default: null },
    userAgent: { type: String, trim: true, default: null },
    browserName: { type: String, trim: true, default: null },
    browserVersion: { type: String, trim: true, default: null },
    osName: { type: String, trim: true, default: null },
    deviceType: { type: String, trim: true, default: null }
  },
  initialInteraction: { type: String, trim: true, default: null, maxlength: 300 },
  clickedItems: [{ type: String, trim: true, maxlength: 300 }],
  appointmentDetails: {
    eventId: { type: String, trim: true, default: null },
    start: { type: Date, default: null },
    end: { type: Date, default: null },
    link: { type: String, trim: true, default: null },
    confirmed: { type: Boolean, default: false }
  },
  leadTypeSwitchHistory: [{
    from: { type: String, trim: true, default: null, maxlength: 150 },
    to: { type: String, trim: true, default: null, maxlength: 150 },
    at: { type: Date, default: Date.now }
  }],
  history: [{
    role: { type: String, enum: ['user', 'assistant', 'system'], default: 'user' },
    content: { type: String, trim: true, default: null }
  }],
  leadDateTime: { type: Date, default: Date.now, index: true },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
}, { timestamps: true });

leadSchema.index({ appId: 1, createdAt: -1 });
leadSchema.index({ userId: 1, createdAt: -1 }); // Legacy index
// Dedupe/reuse query optimization for public interaction leads:
// filters by userId + status + createdAt and may also include appId/sourceChannel.
leadSchema.index({ userId: 1, status: 1, createdAt: -1 });
leadSchema.index({ userId: 1, appId: 1, status: 1, createdAt: -1 });
leadSchema.index({ userId: 1, sourceChannel: 1, status: 1, createdAt: -1 });
leadSchema.index({ userId: 1, appId: 1, sourceChannel: 1, status: 1, createdAt: -1 });

leadSchema.pre('save', function(next) {
  const now = new Date();
  this.updatedAt = now;
  this.leadDateTime = now;
  next();
});

const Lead = mongoose.model('Lead', leadSchema);

const leadCreateSchema = Joi.object({
  appId: Joi.string().allow(null, '').optional(), // For app-scoped leads (from widget)
  title: Joi.string().max(200).allow(null, '').optional(),
  summary: Joi.string().max(500).allow(null, '').optional(),
  description: Joi.string().max(5000).allow(null, '').optional(),
  leadName: Joi.string().max(150).allow(null, '').optional(),
  leadPhoneNumber: Joi.string().max(50).allow(null, '').optional(),
  leadEmail: Joi.string().max(200).allow(null, '').custom((value, helpers) => {
    if (!value || value === '') return null; // Return null for empty values
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(value)) {
      return null; // Return null instead of error for invalid emails
    }
    return value;
  }).optional(),
  leadType: Joi.string().allow(null, '').optional(),
  serviceType: Joi.string().allow(null, '').optional(),
  sourceChannel: Joi.string().allow(null, '').optional(),
  status: Joi.string().valid('interacting', 'in_progress', 'complete', 'confirmed').optional(),
  location: Joi.object({
    country: Joi.string().allow(null, '').optional(),
    countryCode: Joi.string().allow(null, '').optional()
  }).allow(null).optional(),
  clientContext: Joi.object({
    ipAddress: Joi.string().allow(null, '').optional(),
    userAgent: Joi.string().allow(null, '').optional(),
    browserName: Joi.string().allow(null, '').optional(),
    browserVersion: Joi.string().allow(null, '').optional(),
    osName: Joi.string().allow(null, '').optional(),
    deviceType: Joi.string().allow(null, '').optional()
  }).allow(null).optional(),
  initialInteraction: Joi.string().max(300).allow(null, '').optional(),
  clickedItems: Joi.array().items(Joi.string().max(300)).allow(null).optional(),
  appointmentDetails: Joi.object({
    eventId: Joi.string().allow(null, '').optional(),
    start: Joi.date().iso().allow(null).optional(),
    end: Joi.date().iso().allow(null).optional(),
    link: Joi.string().allow(null, '').optional(),
    confirmed: Joi.boolean().optional()
  }).allow(null).optional(),
  leadTypeSwitchHistory: Joi.array().items(
    Joi.object({
      from: Joi.string().max(150).allow(null, '').optional(),
      to: Joi.string().max(150).allow(null, '').optional(),
      at: Joi.date().iso().allow(null).optional()
    })
  ).allow(null).optional(),
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
  sourceChannel: Joi.string().optional(),
  status: Joi.string().valid('interacting', 'in_progress', 'complete', 'confirmed').optional(),
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
    if (!value || value === '') return null; // Return null for empty values
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(value)) {
      return null; // Return null instead of error for invalid emails
    }
    return value;
  }).optional(),
  leadType: Joi.string().allow(null, '').optional(),
  serviceType: Joi.string().allow(null, '').optional(),
  sourceChannel: Joi.string().allow(null, '').optional(),
  status: Joi.string().valid('interacting', 'in_progress', 'complete', 'confirmed').optional(),
  location: Joi.object({
    country: Joi.string().allow(null, '').optional(),
    countryCode: Joi.string().allow(null, '').optional()
  }).allow(null).optional(),
  clientContext: Joi.object({
    ipAddress: Joi.string().allow(null, '').optional(),
    userAgent: Joi.string().allow(null, '').optional(),
    browserName: Joi.string().allow(null, '').optional(),
    browserVersion: Joi.string().allow(null, '').optional(),
    osName: Joi.string().allow(null, '').optional(),
    deviceType: Joi.string().allow(null, '').optional()
  }).allow(null).optional(),
  initialInteraction: Joi.string().max(300).allow(null, '').optional(),
  clickedItems: Joi.array().items(Joi.string().max(300)).allow(null).optional(),
  appointmentDetails: Joi.object({
    eventId: Joi.string().allow(null, '').optional(),
    start: Joi.date().iso().allow(null).optional(),
    end: Joi.date().iso().allow(null).optional(),
    link: Joi.string().allow(null, '').optional(),
    confirmed: Joi.boolean().optional()
  }).allow(null).optional(),
  leadTypeSwitchHistory: Joi.array().items(
    Joi.object({
      from: Joi.string().max(150).allow(null, '').optional(),
      to: Joi.string().max(150).allow(null, '').optional(),
      at: Joi.date().iso().allow(null).optional()
    })
  ).allow(null).optional(),
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


