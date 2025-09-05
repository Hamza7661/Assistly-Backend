const mongoose = require('mongoose');
const Joi = require('joi');

// dayOfWeek: 0=Sunday ... 6=Saturday
const slotSchema = new mongoose.Schema({
  start: { type: String, required: true }, // HH:MM 24h
  end: { type: String, required: true }    // HH:MM 24h
}, { _id: false });

const availabilitySchema = new mongoose.Schema({
  owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  timezone: { type: String, default: 'UTC' },
  dayOfWeek: { type: Number, min: 0, max: 6, required: true, index: true },
  slots: { type: [slotSchema], default: [] },
  allDay: { type: Boolean, default: false },
  updatedAt: { type: Date, default: Date.now }
}, { timestamps: true });

availabilitySchema.index({ owner: 1, dayOfWeek: 1 }, { unique: true });

availabilitySchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

const Availability = mongoose.model('Availability', availabilitySchema);

const slotJoi = Joi.object({
  start: Joi.string().pattern(/^([01]\d|2[0-3]):[0-5]\d$/).required(),
  end: Joi.string().pattern(/^([01]\d|2[0-3]):[0-5]\d$/).required()
});

const availabilityUpsertSchema = Joi.object({
  dayOfWeek: Joi.number().integer().min(0).max(6).required(),
  slots: Joi.array().items(slotJoi).required(),
  allDay: Joi.boolean().optional()
});

const availabilityBulkSchema = Joi.object({
  days: Joi.array().items(
    Joi.object({
      dayOfWeek: Joi.number().integer().min(0).max(6).required(),
      slots: Joi.array().items(slotJoi).required(),
      allDay: Joi.boolean().optional()
    })
  ).min(1).max(7).required()
});

module.exports = {
  Availability,
  availabilityUpsertSchema,
  availabilityBulkSchema
};


