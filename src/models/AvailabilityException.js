const mongoose = require('mongoose');
const Joi = require('joi');

// Exception to weekly availability rules for a specific calendar date.
// date: ISO date string in format YYYY-MM-DD (no time component)
const exceptionSlotSchema = new mongoose.Schema({
  start: { type: String, required: true }, // HH:MM 24h in local timezone
  end:   { type: String, required: true }  // HH:MM 24h in local timezone
}, { _id: false });

const availabilityExceptionSchema = new mongoose.Schema({
  owner: { type: mongoose.Schema.Types.ObjectId, ref: 'App', required: true, index: true },
  date: { type: String, required: true, index: true }, // YYYY-MM-DD
  timezone: { type: String, default: 'UTC' },
  // When true, no availability at all on this date (overrides weekly rules).
  allDayOff: { type: Boolean, default: false },
  // When true, the entire day is available regardless of weekly rules.
  overrideAllDay: { type: Boolean, default: false },
  // If provided, these slots replace weekly slots for this specific date.
  slots: { type: [exceptionSlotSchema], default: [] },
  updatedAt: { type: Date, default: Date.now }
}, { timestamps: true });

availabilityExceptionSchema.index({ owner: 1, date: 1 }, { unique: true });

availabilityExceptionSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

const AvailabilityException = mongoose.model('AvailabilityException', availabilityExceptionSchema);

const exceptionSlotJoi = Joi.object({
  start: Joi.string().pattern(/^([01]\d|2[0-3]):[0-5]\d$/).required(),
  end: Joi.string().pattern(/^([01]\d|2[0-3]):[0-5]\d$/).required()
});

const availabilityExceptionUpsertSchema = Joi.object({
  date: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).required(),
  timezone: Joi.string().optional(),
  allDayOff: Joi.boolean().optional(),
  overrideAllDay: Joi.boolean().optional(),
  slots: Joi.array().items(exceptionSlotJoi).optional()
}).custom((value, helpers) => {
  const { allDayOff, overrideAllDay, slots } = value;
  if (allDayOff && (overrideAllDay || (Array.isArray(slots) && slots.length > 0))) {
    return helpers.error('any.invalid');
  }
  if (overrideAllDay && Array.isArray(slots) && slots.length > 0) {
    return helpers.error('any.invalid');
  }
  return value;
}, 'mutually exclusive exception fields');

const availabilityExceptionBulkSchema = Joi.object({
  exceptions: Joi.array().items(
    Joi.object({
      date: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).required(),
      timezone: Joi.string().optional(),
      allDayOff: Joi.boolean().optional(),
      overrideAllDay: Joi.boolean().optional(),
      slots: Joi.array().items(exceptionSlotJoi).optional()
    }).custom((value, helpers) => {
      const { allDayOff, overrideAllDay, slots } = value;
      if (allDayOff && (overrideAllDay || (Array.isArray(slots) && slots.length > 0))) {
        return helpers.error('any.invalid');
      }
      if (overrideAllDay && Array.isArray(slots) && slots.length > 0) {
        return helpers.error('any.invalid');
      }
      return value;
    }, 'mutually exclusive exception fields')
  ).min(1).required()
});

module.exports = {
  AvailabilityException,
  availabilityExceptionUpsertSchema,
  availabilityExceptionBulkSchema
};

