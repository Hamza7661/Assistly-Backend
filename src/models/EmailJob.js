const mongoose = require('mongoose');

const EMAIL_JOB_STATUSES = [
  'queued',
  'scheduled',
  'processing',
  'sent',
  'failed',
  'dead_letter',
  'cancelled',
];

const EMAIL_FINAL_STATUSES = [
  'sent_pending_event',
  'delivered',
  'bounced',
  'dropped',
  'spam_reported',
  'failed',
];

const emailJobSchema = new mongoose.Schema(
  {
    appId: { type: mongoose.Schema.Types.ObjectId, ref: 'App', index: true, default: null },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true, default: null },
    leadId: { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', index: true, default: null },
    templateType: { type: String, required: true, trim: true, index: true },
    dedupeKey: { type: String, required: true, trim: true, unique: true },
    idempotencyKey: { type: String, trim: true, default: null },
    queueName: { type: String, trim: true, default: 'email-jobs' },
    status: { type: String, enum: EMAIL_JOB_STATUSES, default: 'queued', index: true },
    finalStatus: { type: String, enum: EMAIL_FINAL_STATUSES, default: 'sent_pending_event', index: true },
    runAt: { type: Date, default: Date.now, index: true },
    nextRetryAt: { type: Date, default: null, index: true },
    priority: { type: Number, default: 5 },
    attempts: { type: Number, default: 0 },
    maxAttempts: { type: Number, default: 4 },
    lockedAt: { type: Date, default: null },
    workerId: { type: String, trim: true, default: null },
    sentAt: { type: Date, default: null },
    processedAt: { type: Date, default: null },
    deliveredAt: { type: Date, default: null },
    bouncedAt: { type: Date, default: null },
    droppedAt: { type: Date, default: null },
    spamReportedAt: { type: Date, default: null },
    firstOpenedAt: { type: Date, default: null },
    lastOpenedAt: { type: Date, default: null },
    firstClickedAt: { type: Date, default: null },
    lastClickedAt: { type: Date, default: null },
    openCount: { type: Number, default: 0 },
    clickCount: { type: Number, default: 0 },
    providerMessageId: { type: String, trim: true, default: null, index: true },
    providerName: { type: String, trim: true, default: 'sendgrid' },
    toEmail: { type: String, trim: true, lowercase: true, default: null, index: true },
    fromEmail: { type: String, trim: true, lowercase: true, default: null },
    subject: { type: String, trim: true, default: null },
    payload: { type: mongoose.Schema.Types.Mixed, default: {} },
    lastError: { type: String, trim: true, default: null },
    lastErrorCode: { type: String, trim: true, default: null },
  },
  { timestamps: true }
);

emailJobSchema.index({ status: 1, runAt: 1 });
emailJobSchema.index({ appId: 1, createdAt: -1 });
emailJobSchema.index({ templateType: 1, createdAt: -1 });

const EmailJob = mongoose.model('EmailJob', emailJobSchema);

module.exports = {
  EmailJob,
  EMAIL_JOB_STATUSES,
  EMAIL_FINAL_STATUSES,
};
