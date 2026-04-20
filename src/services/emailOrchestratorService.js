const os = require('os');
const crypto = require('crypto');
const Queue = require('bull');
const { EmailJob } = require('../models/EmailJob');
const { EmailMessage } = require('../models/EmailMessage');
const { EmailEvent } = require('../models/EmailEvent');
const { EmailSuppression } = require('../models/EmailSuppression');
const { App } = require('../models/App');
const { User } = require('../models/User');
const { Integration } = require('../models/Integration');
const EmailService = require('../utils/emailService');
const { logger } = require('../utils/logger');

const DEFAULT_QUEUE_NAME = process.env.EMAIL_QUEUE_NAME || 'email-jobs';
const EVENT_TTL_DAYS = Number(process.env.EMAIL_EVENT_TTL_DAYS || 90);
const WORKER_ID = `${os.hostname()}-${process.pid}`;

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function prettifyLabel(value, fallback = 'Not provided') {
  const raw = String(value || '').trim();
  if (!raw) return fallback;
  return raw
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

class EmailOrchestratorService {
  constructor() {
    this.redisUrl = process.env.REDIS_URL || '';
    this.emailService = null;
    this.queue = null;
    this.queueReady = false;
    this.poller = null;
    this.polling = false;
    this.concurrency = Number(process.env.EMAIL_WORKER_CONCURRENCY || 3);
    this.pollMs = Number(process.env.EMAIL_WORKER_POLL_MS || 5000);
    this.retryBackoffMs = [60 * 1000, 5 * 60 * 1000, 15 * 60 * 1000];
  }

  ensureEmailService() {
    if (!this.emailService) this.emailService = new EmailService();
    return this.emailService;
  }

  async initQueue() {
    if (!this.redisUrl || this.queue) return;
    try {
      this.queue = new Queue(DEFAULT_QUEUE_NAME, this.redisUrl);
      this.queue.on('error', (error) => {
        logger.warn('Email queue error; falling back to DB polling', { error: error.message });
        this.queueReady = false;
      });
      this.queue.on('ready', () => {
        this.queueReady = true;
      });
      await this.queue.isReady();
      this.queueReady = true;
    } catch (error) {
      logger.warn('Failed to initialize email queue; using DB polling', { error: error.message });
      this.queue = null;
      this.queueReady = false;
    }
  }

  async isSuppressed(email, appId = null) {
    const normalized = normalizeEmail(email);
    if (!normalized) return false;
    const now = new Date();
    const row = await EmailSuppression.findOne({
      email: normalized,
      $and: [
        {
          $or: [
            { scope: 'global' },
            ...(appId ? [{ scope: 'app', appId }] : []),
          ],
        },
        {
          $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }],
        },
      ],
    }).lean();
    return !!row;
  }

  async enqueueOrUpdateJob({
    dedupeKey,
    templateType,
    runAt = new Date(),
    priority = 5,
    appId = null,
    userId = null,
    leadId = null,
    toEmail = '',
    fromEmail = '',
    subject = '',
    payload = {},
    maxAttempts = 4,
  }) {
    const status = runAt > new Date() ? 'scheduled' : 'queued';
    const update = {
      templateType,
      runAt,
      priority,
      appId: appId || null,
      userId: userId || null,
      leadId: leadId || null,
      toEmail: normalizeEmail(toEmail) || null,
      fromEmail: normalizeEmail(fromEmail) || null,
      subject: subject || null,
      payload,
      maxAttempts,
      status,
      lockedAt: null,
      workerId: null,
      nextRetryAt: null,
    };

    const job = await EmailJob.findOneAndUpdate(
      { dedupeKey },
      {
        $set: update,
        $setOnInsert: {
          dedupeKey,
          idempotencyKey: crypto.randomUUID(),
          attempts: 0,
          finalStatus: 'sent_pending_event',
          providerName: 'sendgrid',
        },
      },
      { upsert: true, new: true }
    );

    if (this.queueReady && this.queue) {
      await this.queue.add(
        { emailJobId: String(job._id) },
        {
          jobId: String(job._id),
          delay: Math.max(0, job.runAt.getTime() - Date.now()),
          removeOnComplete: true,
          removeOnFail: true,
        }
      );
    }
    return job;
  }

  async enqueueLeadDigest(lead, options = {}) {
    if (!lead) return null;
    const hasPersonalInfo = !!(
      String(lead?.leadName || '').trim() ||
      String(lead?.leadEmail || '').trim() ||
      String(lead?.leadPhoneNumber || '').trim()
    );
    if (!hasPersonalInfo) return null;

    const status = String(lead?.status || '').trim().toLowerCase();
    const completed = status === 'complete' || status === 'confirmed';
    const delayMinutes = Number(process.env.LEAD_DIGEST_DELAY_MINUTES || 30);
    const runAt = completed || options.sendNow
      ? new Date()
      : new Date(Date.now() + delayMinutes * 60 * 1000);

    const appId = lead.appId ? String(lead.appId) : '';
    const ownerId = lead.userId ? String(lead.userId) : '';
    const [app, owner, integration] = await Promise.all([
      appId ? App.findById(appId).select('_id owner name').lean() : null,
      appId
        ? App.findById(appId).select('owner').lean().then((appDoc) => {
            if (!appDoc?.owner) return null;
            return User.findById(appDoc.owner).select('email').lean();
          })
        : (ownerId ? User.findById(ownerId).select('email').lean() : null),
      appId ? Integration.findOne({ owner: appId }).select('companyName primaryColor chatbotImage').lean() : null,
    ]);
    const frontendBaseUrl = (process.env.FRONTEND_BASE_URL || process.env.FRONTEND_URL || '').replace(/\/$/, '');
    const viewLeadUrl = appId
      ? `${frontendBaseUrl}/leads?appId=${encodeURIComponent(appId)}&leadId=${encodeURIComponent(String(lead._id))}`
      : `${frontendBaseUrl}/leads?leadId=${encodeURIComponent(String(lead._id))}`;
    const companyName = integration?.companyName || app?.name || 'Business';
    const logoUrl = integration?.chatbotImage?.filename
      ? `${frontendBaseUrl}/uploads/chatbots/${integration.chatbotImage.filename}`
      : '';
    const businessData = {
      appId,
      companyName,
      primaryColor: integration?.primaryColor || undefined,
      email: owner?.email || '',
      logoUrl,
    };
    const leadData = {
      leadId: String(lead._id),
      leadType: prettifyLabel(lead.leadType, 'General Enquiry'),
      serviceType: prettifyLabel(lead.serviceType),
      sourceChannel: prettifyLabel(lead.sourceChannel, 'Chatbot'),
      status: prettifyLabel(lead.status, 'Interacting'),
      customerName: String(lead.leadName || '').trim() || 'Not provided',
      customerEmail: String(lead.leadEmail || '').trim() || 'Not provided',
      customerPhone: String(lead.leadPhoneNumber || '').trim() || 'Not provided',
      initialInteraction: String(lead.initialInteraction || '').trim() || 'Widget opened',
      clickedItems: Array.isArray(lead.clickedItems) ? lead.clickedItems : [],
      summary: String(lead.summary || '').trim(),
      description: String(lead.description || '').trim(),
      conversationHistory: Array.isArray(lead.history) ? lead.history.slice(-30) : [],
      completedAtText: new Date(lead.updatedAt || lead.createdAt || Date.now()).toLocaleString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      }),
      createdAtText: new Date(lead.updatedAt || lead.createdAt || Date.now()).toLocaleString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      }),
      viewLeadUrl,
    };
    const payload = {
      isCompleted: completed,
      businessData,
      leadData,
      to: businessData.email || '',
      subject: completed
        ? `Workflow Completed - ${leadData.leadType} (${leadData.customerName})`
        : `New Lead Generated - ${leadData.leadType} (${leadData.customerName})`,
    };
    if (!businessData.email) return null;

    return this.enqueueOrUpdateJob({
      dedupeKey: `lead:${String(lead._id)}:digest:v1`,
      templateType: 'lead_digest',
      runAt,
      priority: completed ? 2 : 5,
      appId: lead.appId || null,
      userId: lead.userId || null,
      leadId: lead._id,
      toEmail: businessData.email || '',
      payload,
      maxAttempts: 4,
    });
  }

  async enqueueTemplateEmail({
    templateType,
    dedupeKey,
    toEmail,
    appId = null,
    userId = null,
    leadId = null,
    payload = {},
    runAt = new Date(),
    priority = 5,
    maxAttempts = 4,
  }) {
    return this.enqueueOrUpdateJob({
      dedupeKey,
      templateType,
      runAt,
      priority,
      appId,
      userId,
      leadId,
      toEmail,
      payload,
      maxAttempts,
    });
  }

  async claimNextDueJob() {
    const now = new Date();
    return EmailJob.findOneAndUpdate(
      {
        status: { $in: ['queued', 'scheduled'] },
        runAt: { $lte: now },
        $or: [{ nextRetryAt: null }, { nextRetryAt: { $lte: now } }],
      },
      {
        $set: {
          status: 'processing',
          lockedAt: now,
          workerId: WORKER_ID,
        },
      },
      { sort: { priority: 1, runAt: 1 }, new: true }
    );
  }

  isTransientError(error) {
    const msg = String(error?.message || '').toLowerCase();
    if (!msg) return true;
    if (msg.includes('invalid') || msg.includes('bounce') || msg.includes('spam')) return false;
    if (msg.includes('400') || msg.includes('401') || msg.includes('403') || msg.includes('404')) return false;
    return true;
  }

  async recordEmailMessage(job, payload, result) {
    const htmlBody = String(payload?.htmlContent || payload?.htmlTemplate || '');
    const textBody = String(payload?.textContent || '');
    await EmailMessage.create({
      emailJobId: job._id,
      appId: job.appId,
      userId: job.userId,
      templateType: job.templateType,
      to: job.toEmail || payload?.to || '',
      from: payload?.fromEmail || process.env.FROM_EMAIL || '',
      subject: payload?.subject || job.subject || '',
      htmlBody,
      textBody,
      meta: {
        providerMessageId: result?.messageId || null,
        payloadMeta: payload?.meta || {},
      },
      conversationPreview: String(payload?.conversationPreview || '').slice(0, 3000),
    });
  }

  async processJob(job) {
    const payload = job.payload || {};
    const emailService = this.ensureEmailService();
    const toEmail = normalizeEmail(job.toEmail || payload.to || payload.email);
    if (!toEmail) throw new Error('Recipient email is required');
    if (await this.isSuppressed(toEmail, job.appId)) {
      await EmailJob.findByIdAndUpdate(job._id, {
        $set: {
          status: 'cancelled',
          finalStatus: 'failed',
          lastError: 'Recipient is suppressed due to prior deliverability event',
          lockedAt: null,
          workerId: null,
        },
      });
      return;
    }

    let result = null;
    switch (job.templateType) {
      case 'lead_digest':
        result = payload?.isCompleted
          ? await emailService.sendCompletedWorkflowNotificationEmail(payload.businessData, payload.leadData)
          : await emailService.sendQualifiedLeadNotificationEmail(payload.businessData, payload.leadData);
        break;
      case 'welcome_email':
        result = await emailService.sendWelcomeEmail(payload.userData, payload.businessData, payload.welcomeData);
        break;
      case 'verification_email':
        result = await emailService.sendVerificationEmail(payload.userData, payload.templateData);
        break;
      case 'password_reset_email':
        result = await emailService.sendPasswordResetEmail(payload.userData, payload.templateData);
        break;
      case 'otp_email':
        result = await emailService.sendOtpEmail(payload.userData, payload.templateData);
        break;
      case 'appointment_confirmation_email':
        result = await emailService.sendAppointmentConfirmationEmail(
          payload.customerData,
          payload.appointmentData,
          payload.businessData
        );
        break;
      case 'appointment_business_notification_email':
        result = await emailService.sendAppointmentBusinessNotificationEmail(
          payload.businessData,
          payload.customerData,
          payload.appointmentData
        );
        break;
      default:
        result = await emailService.sendEmail(payload);
    }

    await this.recordEmailMessage(job, payload, result);
    await EmailJob.findByIdAndUpdate(job._id, {
      $set: {
        status: 'sent',
        finalStatus: 'sent_pending_event',
        attempts: (job.attempts || 0) + 1,
        sentAt: new Date(),
        processedAt: new Date(),
        providerMessageId: result?.messageId || null,
        lockedAt: null,
        workerId: null,
        lastError: null,
        lastErrorCode: null,
      },
    });
  }

  async processOne() {
    const job = await this.claimNextDueJob();
    if (!job) return false;
    try {
      await this.processJob(job);
      return true;
    } catch (error) {
      const nextAttempts = (job.attempts || 0) + 1;
      const transient = this.isTransientError(error);
      const maxAttempts = Number(job.maxAttempts || 4);
      const exhausted = nextAttempts >= maxAttempts;
      const baseDelay = this.retryBackoffMs[Math.min(nextAttempts - 1, this.retryBackoffMs.length - 1)];
      const jitter = Math.floor(Math.random() * 5000);
      const nextRetryAt = new Date(Date.now() + baseDelay + jitter);

      await EmailJob.findByIdAndUpdate(job._id, {
        $set: {
          status: transient && !exhausted ? 'queued' : exhausted ? 'dead_letter' : 'failed',
          finalStatus: 'failed',
          attempts: nextAttempts,
          nextRetryAt: transient && !exhausted ? nextRetryAt : null,
          lastError: error.message,
          lastErrorCode: error.code || null,
          lockedAt: null,
          workerId: null,
        },
      });
      logger.error('Email job failed', {
        emailJobId: String(job._id),
        templateType: job.templateType,
        attempts: nextAttempts,
        transient,
        exhausted,
        error: error.message,
      });
      return true;
    }
  }

  async processDueJobs(limit = this.concurrency) {
    let processed = 0;
    for (let i = 0; i < limit; i += 1) {
      const did = await this.processOne();
      if (!did) break;
      processed += 1;
    }
    return processed;
  }

  async startWorker() {
    await this.initQueue();
    if (this.poller) return;
    this.poller = setInterval(async () => {
      if (this.polling) return;
      this.polling = true;
      try {
        await this.processDueJobs();
      } catch (error) {
        logger.error('Email worker polling loop failed', { error: error.message });
      } finally {
        this.polling = false;
      }
    }, this.pollMs);
    if (typeof this.poller.unref === 'function') this.poller.unref();
    logger.info('Email worker started', {
      workerId: WORKER_ID,
      queueEnabled: this.queueReady,
      pollMs: this.pollMs,
      concurrency: this.concurrency,
    });
  }

  async stopWorker() {
    if (this.poller) {
      clearInterval(this.poller);
      this.poller = null;
    }
    if (this.queue) {
      await this.queue.close();
      this.queue = null;
      this.queueReady = false;
    }
  }

  buildEventId(event) {
    const source = [
      event.sg_event_id || '',
      event.sg_message_id || '',
      event.event || '',
      event.timestamp || '',
      event.email || '',
    ].join('|');
    return crypto.createHash('sha1').update(source).digest('hex');
  }

  async handleProviderEvents(events = []) {
    let accepted = 0;
    for (const event of events) {
      const providerEventId = this.buildEventId(event);
      const eventType = String(event.event || '').toLowerCase();
      if (!['processed', 'delivered', 'open', 'click', 'bounce', 'dropped', 'spamreport'].includes(eventType)) {
        continue;
      }
      const eventAt = event.timestamp ? new Date(Number(event.timestamp) * 1000) : new Date();
      const expireAt = new Date(eventAt.getTime() + EVENT_TTL_DAYS * 24 * 60 * 60 * 1000);
      const providerMessageId = String(event.sg_message_id || '').trim() || null;

      let created = false;
      try {
        await EmailEvent.create({
          providerEventId,
          providerMessageId,
          eventType,
          eventAt,
          rawPayload: event,
          expireAt,
        });
        created = true;
      } catch (error) {
        if (error?.code !== 11000) throw error;
      }
      if (!created) continue;
      accepted += 1;

      if (!providerMessageId) continue;
      const job = await EmailJob.findOne({ providerMessageId });
      if (!job) continue;
      const patch = {};

      if (eventType === 'processed' && !job.processedAt) patch.processedAt = eventAt;
      if (eventType === 'delivered' && !job.deliveredAt) {
        patch.deliveredAt = eventAt;
        patch.finalStatus = 'delivered';
      }
      if (eventType === 'open') {
        patch.openCount = Number(job.openCount || 0) + 1;
        if (!job.firstOpenedAt || eventAt < job.firstOpenedAt) patch.firstOpenedAt = eventAt;
        if (!job.lastOpenedAt || eventAt > job.lastOpenedAt) patch.lastOpenedAt = eventAt;
      }
      if (eventType === 'click') {
        patch.clickCount = Number(job.clickCount || 0) + 1;
        if (!job.firstClickedAt || eventAt < job.firstClickedAt) patch.firstClickedAt = eventAt;
        if (!job.lastClickedAt || eventAt > job.lastClickedAt) patch.lastClickedAt = eventAt;
      }
      if (eventType === 'bounce') {
        patch.bouncedAt = eventAt;
        patch.finalStatus = 'bounced';
        await EmailSuppression.findOneAndUpdate(
          { email: normalizeEmail(job.toEmail), scope: 'global', appId: null },
          {
            $set: {
              reason: 'hard_bounce',
              sourceEventId: providerEventId,
              expiresAt: null,
            },
          },
          { upsert: true }
        );
      }
      if (eventType === 'dropped') {
        patch.droppedAt = eventAt;
        patch.finalStatus = 'dropped';
      }
      if (eventType === 'spamreport') {
        patch.spamReportedAt = eventAt;
        patch.finalStatus = 'spam_reported';
        await EmailSuppression.findOneAndUpdate(
          { email: normalizeEmail(job.toEmail), scope: 'global', appId: null },
          {
            $set: {
              reason: 'spam_report',
              sourceEventId: providerEventId,
              expiresAt: null,
            },
          },
          { upsert: true }
        );
      }

      if (Object.keys(patch).length > 0) {
        await EmailJob.updateOne({ _id: job._id }, { $set: patch });
      }
      await EmailEvent.updateOne({ providerEventId }, { $set: { emailJobId: job._id, appId: job.appId, userId: job.userId } });
    }
    return { accepted };
  }
}

module.exports = new EmailOrchestratorService();
