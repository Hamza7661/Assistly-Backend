const mongoose = require('mongoose');
const Joi = require('joi');

const appointmentSchema = new mongoose.Schema({
  owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  title: { type: String, trim: true, default: '' },
  description: { type: String, trim: true, default: '' },
  startAt: { type: Date, required: true, index: true },
  endAt: { type: Date, required: true, index: true },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
}, { timestamps: true });

appointmentSchema.index({ owner: 1, startAt: 1 });

appointmentSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

const Appointment = mongoose.model('Appointment', appointmentSchema);

const appointmentCreateSchema = Joi.object({
  title: Joi.string().max(200).allow('').optional(),
  description: Joi.string().max(2000).allow('').optional(),
  startAt: Joi.date().iso().required(),
  endAt: Joi.date().iso().required()
}).custom((value, helpers) => {
  if (new Date(value.endAt) <= new Date(value.startAt)) {
    return helpers.error('any.invalid');
  }
  return value;
}, 'start/end validation');

const appointmentQuerySchema = Joi.object({
  from: Joi.date().iso().optional(),
  to: Joi.date().iso().optional(),
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
  q: Joi.string().max(200).optional(),
  sortBy: Joi.string().valid('startAt','endAt','createdAt','updatedAt').default('startAt'),
  sortOrder: Joi.string().valid('asc','desc').default('asc')
});

const appointmentUpdateSchema = Joi.object({
  title: Joi.string().max(200).allow(''),
  description: Joi.string().max(2000).allow(''),
  startAt: Joi.date().iso(),
  endAt: Joi.date().iso()
}).custom((value, helpers) => {
  if (value.startAt && value.endAt) {
    if (new Date(value.endAt) <= new Date(value.startAt)) {
      return helpers.error('any.invalid');
    }
  }
  return value;
}, 'start/end validation');

module.exports = {
  Appointment,
  appointmentCreateSchema,
  appointmentQuerySchema,
  appointmentUpdateSchema
};


