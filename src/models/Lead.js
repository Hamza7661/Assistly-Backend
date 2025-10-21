const mongoose = require('mongoose');
const Joi = require('joi');
const { LEAD_TYPES_VALUES } = require('../enums/leadTypes');
const { SERVICES_LIST } = require('../enums/services');

const leadSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  title: { type: String, trim: true, required: true, maxlength: 200 },
  summary: { type: String, trim: true, default: '', maxlength: 500 },
  description: { type: String, trim: true, default: '', maxlength: 5000 },
  leadName: { type: String, trim: true, required: true, maxlength: 150 },
  leadPhoneNumber: { type: String, trim: true, default: null, maxlength: 50 },
  leadEmail: { type: String, trim: true, lowercase: true, default: null, maxlength: 200 },
  leadType: { type: String, required: true, index: true },
  serviceType: { type: String, required: true, index: true },
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
  title: Joi.string().max(200).required(),
  summary: Joi.string().max(500).allow(''),
  description: Joi.string().max(5000).allow(''),
  leadName: Joi.string().max(150).required(),
  leadPhoneNumber: Joi.string().max(50).allow(null, ''),
  leadEmail: Joi.string().email().max(200).allow(null, ''),
  leadType: Joi.string().required(),
  serviceType: Joi.string().required()
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
  title: Joi.string().max(200),
  summary: Joi.string().max(500).allow(''),
  description: Joi.string().max(5000).allow(''),
  leadName: Joi.string().max(150),
  leadPhoneNumber: Joi.string().max(50).allow(null, ''),
  leadEmail: Joi.string().email().max(200).allow(null, ''),
  leadType: Joi.string(),
  serviceType: Joi.string()
});

module.exports = {
  Lead,
  leadCreateSchema,
  leadQuerySchema,
  leadUpdateSchema
};


