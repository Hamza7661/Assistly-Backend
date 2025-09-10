const mongoose = require('mongoose');
const Joi = require('joi');

const integrationSchema = new mongoose.Schema({
  owner: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
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
  greeting: {
    type: String,
    default: process.env.DEFAULT_GREETING || 'Hello! How can I help you today?',
    maxlength: 500,
    trim: true
  },
  primaryColor: {
    type: String,
    default: process.env.DEFAULT_PRIMARY_COLOR || '#3B82F6',
    validate: {
      validator: function(v) {
        return /^#[0-9A-Fa-f]{6}$/.test(v);
      },
      message: 'Primary color must be a valid hex color (e.g., #3B82F6)'
    }
  }
}, {
  timestamps: true
});

// Ensure one integration per user
integrationSchema.index({ owner: 1 }, { unique: true });

// Joi validation schemas
const integrationValidationSchema = Joi.object({
  assistantName: Joi.string().max(50).optional(),
  greeting: Joi.string().max(500).optional(),
  primaryColor: Joi.string().pattern(/^#[0-9A-Fa-f]{6}$/).optional()
});

const integrationUpdateValidationSchema = Joi.object({
  assistantName: Joi.string().max(50).optional(),
  greeting: Joi.string().max(500).optional(),
  primaryColor: Joi.string().pattern(/^#[0-9A-Fa-f]{6}$/).optional()
}).min(1);

const Integration = mongoose.model('Integration', integrationSchema);

module.exports = {
  Integration,
  integrationValidationSchema,
  integrationUpdateValidationSchema
};
