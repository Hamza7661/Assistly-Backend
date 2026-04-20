const mongoose = require('mongoose');

const emailSuppressionSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, trim: true, lowercase: true, index: true },
    scope: { type: String, enum: ['global', 'app'], default: 'global', index: true },
    appId: { type: mongoose.Schema.Types.ObjectId, ref: 'App', index: true, default: null },
    reason: {
      type: String,
      enum: ['hard_bounce', 'spam_report', 'manual_unsubscribe', 'admin_block'],
      required: true,
    },
    sourceEventId: { type: String, trim: true, default: null },
    expiresAt: { type: Date, default: null },
  },
  { timestamps: true }
);

emailSuppressionSchema.index({ email: 1, scope: 1, appId: 1 }, { unique: true });

const EmailSuppression = mongoose.model('EmailSuppression', emailSuppressionSchema);

module.exports = { EmailSuppression };
