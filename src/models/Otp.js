const mongoose = require('mongoose');
const Joi = require('joi');

const otpSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  type: {
    type: String,
    enum: ['email', 'sms'],
    required: true,
    index: true
  },
  target: {
    type: String,
    required: true, // email address or phone number
    index: true
  },
  otp: {
    type: String,
    required: true,
    minlength: 4,
    maxlength: 8
  },
  expiresAt: {
    type: Date,
    required: true,
    default: () => new Date(Date.now() + 10 * 60 * 1000), // 10 minutes from now
    index: { expireAfterSeconds: 0 }
  },
  attempts: {
    type: Number,
    default: 0,
    max: 3
  },
  isVerified: {
    type: Boolean,
    default: false
  },
  verifiedAt: {
    type: Date,
    default: null
  }
}, {
  timestamps: true
});

// Ensure one active OTP per user/type/target combination
otpSchema.index({ userId: 1, type: 1, target: 1, isVerified: 1 }, { unique: true, partialFilterExpression: { isVerified: false } });

// Joi validation schemas
const sendEmailOtpValidationSchema = Joi.object({
  email: Joi.string().email().required()
});

const sendSmsOtpValidationSchema = Joi.object({
  phoneNumber: Joi.string().pattern(/^\+?[1-9]\d{1,14}$/).required()
});

const verifyOtpValidationSchema = Joi.object({
  otp: Joi.string().min(4).max(8).required()
});

const Otp = mongoose.model('Otp', otpSchema);

module.exports = {
  Otp,
  sendEmailOtpValidationSchema,
  sendSmsOtpValidationSchema,
  verifyOtpValidationSchema
};
