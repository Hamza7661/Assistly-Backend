const mongoose = require('mongoose');

// Schema for storing industry-based seed data templates
const industrySeedSchema = new mongoose.Schema({
  industry: {
    type: String,
    required: true,
    unique: true,
    index: true,
    trim: true
  },
  // Default workflows/conversation flows for this industry
  workflows: [{
    title: { type: String, required: true, trim: true, maxlength: 200 },
    question: { type: String, required: true, trim: true, maxlength: 500 },
    questionTypeId: { type: Number, required: true, default: 1 },
    isRoot: { type: Boolean, default: false },
    order: { type: Number, default: 0 },
    workflowGroupId: { type: String, default: null }, // Will be set when copying
    children: [{ type: Object }] // Nested workflows
  }],
  // Default FAQs/training data for this industry
  faqs: [{
    question: { type: String, required: true, trim: true, minlength: 3, maxlength: 500 },
    answer: { type: String, required: true, trim: true, minlength: 1, maxlength: 10000 }
  }],
  // Default lead types for this industry
  leadTypes: [{
    id: { type: Number, required: true },
    value: { type: String, required: true, trim: true },
    text: { type: String, required: true, trim: true },
    linkedWorkflow: { type: String, trim: true }, // Optional: links to workflow title
    linkedService: { type: String, trim: true } // Optional: links to service plan name
  }],
  // Default service plans/treatment plans for this industry
  servicePlans: [{
    name: { type: String, required: true, trim: true, maxlength: 200 },
    description: { type: String, trim: true, maxlength: 1000 },
    price: {
      amount: { type: Number, default: 0, min: 0 },
      currency: { type: String, default: 'USD' }
    },
    workflows: [{ type: String }] // Workflow IDs that should be attached
  }],
  // Default introduction/greeting message
  introduction: {
    type: String,
    trim: true,
    maxlength: 1000,
    default: ''
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

industrySeedSchema.index({ industry: 1, isActive: 1 });

industrySeedSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

const IndustrySeed = mongoose.model('IndustrySeed', industrySeedSchema);

module.exports = { IndustrySeed };
