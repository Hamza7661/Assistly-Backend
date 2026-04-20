const mongoose = require('mongoose');

const emailMessageSchema = new mongoose.Schema(
  {
    emailJobId: { type: mongoose.Schema.Types.ObjectId, ref: 'EmailJob', required: true, index: true },
    appId: { type: mongoose.Schema.Types.ObjectId, ref: 'App', index: true, default: null },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true, default: null },
    templateType: { type: String, trim: true, required: true, index: true },
    to: { type: String, trim: true, lowercase: true, required: true },
    from: { type: String, trim: true, lowercase: true, default: null },
    subject: { type: String, trim: true, default: null },
    htmlBody: { type: String, default: '' },
    textBody: { type: String, default: '' },
    meta: { type: mongoose.Schema.Types.Mixed, default: {} },
    conversationPreview: { type: String, default: '' },
  },
  { timestamps: true }
);

emailMessageSchema.index({ createdAt: -1 });

const EmailMessage = mongoose.model('EmailMessage', emailMessageSchema);

module.exports = { EmailMessage };
