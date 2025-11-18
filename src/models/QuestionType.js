const mongoose = require('mongoose');

const questionTypeSchema = new mongoose.Schema({
  id: {
    type: Number,
    required: true,
    unique: true,
    min: 1
  },
  code: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    lowercase: true
  },
  value: {
    type: String,
    required: true,
    trim: true
  },
  isActive: {
    type: Boolean,
    default: true
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
  timestamps: true
});

questionTypeSchema.index({ id: 1 });
questionTypeSchema.index({ code: 1 });
questionTypeSchema.index({ isActive: 1 });

const QuestionType = mongoose.model('QuestionType', questionTypeSchema);

module.exports = { QuestionType };

