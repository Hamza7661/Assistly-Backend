const mongoose = require('mongoose');
const Joi = require('joi');
const { LEAD_TYPES_VALUES } = require('../enums/leadTypes');
const { SERVICES_LIST } = require('../enums/services');

const leadSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  title: { type: String, trim: true, required: true, maxlength: 200 },
  summary: { type: String, trim: true, default: '', maxlength: 500 },
  description: { type: String, trim: true, default: '', maxlength: 5000 },
  leadType: { type: String, enum: LEAD_TYPES_VALUES, required: true, index: true },
  serviceType: { type: String, enum: SERVICES_LIST, required: true, index: true },
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
  leadType: Joi.string().valid(...LEAD_TYPES_VALUES).required(),
  serviceType: Joi.string().valid(...SERVICES_LIST).required()
});

const leadQuerySchema = Joi.object({
  q: Joi.string().max(200).optional(),
  leadType: Joi.string().valid(...LEAD_TYPES_VALUES).optional(),
  serviceType: Joi.string().valid(...SERVICES_LIST).optional(),
  sortBy: Joi.string().valid('leadDateTime', 'createdAt', 'updatedAt', 'title').default('leadDateTime'),
  sortOrder: Joi.string().valid('asc', 'desc').default('desc'),
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20)
});

const leadUpdateSchema = Joi.object({
  title: Joi.string().max(200),
  summary: Joi.string().max(500).allow(''),
  description: Joi.string().max(5000).allow(''),
  leadType: Joi.string().valid(...LEAD_TYPES_VALUES),
  serviceType: Joi.string().valid(...SERVICES_LIST)
});

module.exports = {
  Lead,
  leadCreateSchema,
  leadQuerySchema,
  leadUpdateSchema
};


