const express = require('express');
const { v4: uuidv4 } = require('uuid');
const mongoose = require('mongoose');
const { logger } = require('../utils/logger');
const { AppError } = require('../utils/errorHandler');
const { User } = require('../models/User');
const EmailService = require('../utils/emailService');
const { authenticateToken, requireUserOrAdmin } = require('../middleware/auth');
const { verifyAppOwnership } = require('../middleware/appOwnership');
const { EmailJob } = require('../models/EmailJob');
const emailOrchestratorService = require('../services/emailOrchestratorService');
const { App } = require('../models/App');
const { Integration } = require('../models/Integration');

const router = express.Router();
const emailService = new EmailService();

class EmailController {
  /**
   * Send verification email after signup
   * Frontend provides the email template and content
   */
  static async sendVerificationEmail(req, res, next) {
    try {
      const { email, htmlTemplate, templateData } = req.body;

      if (!email || (!htmlTemplate && !templateData?.htmlContent)) {
        throw new AppError('Email and HTML template are required', 400);
      }

      const htmlContent = htmlTemplate || templateData?.htmlContent;
      const textContent = templateData?.textContent || '';

      // Find user by email
      const user = await User.findByEmail(email);
      if (!user) {
        throw new AppError('User not found', 404);
      }

      if (user.emailVerified) {
        throw new AppError('Email is already verified', 400);
      }

      // Generate verification token if not exists
      if (!user.emailVerificationToken) {
        user.emailVerificationToken = uuidv4();
        user.emailVerificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
        await user.save();
      }

      // Check if token is expired
      if (user.emailVerificationExpires < new Date()) {
        user.emailVerificationToken = uuidv4();
        user.emailVerificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
        await user.save();
      }

      await emailOrchestratorService.enqueueTemplateEmail({
        templateType: 'verification_email',
        dedupeKey: `user:${String(user._id)}:verification:${String(user.emailVerificationToken)}`,
        toEmail: user.email,
        userId: user._id,
        payload: {
          userData: {
            email: user.email,
            firstName: user.firstName,
            verificationToken: user.emailVerificationToken
          },
          templateData: { htmlTemplate: htmlContent, textContent }
        }
      });

      logger.info('Verification email sent', { 
        userId: user._id, 
        email: user.email
      });

      res.status(200).json({
        status: 'success',
        message: 'Verification email sent successfully',
        data: {
          queued: true,
          expiresAt: user.emailVerificationExpires,
          verificationToken: user.emailVerificationToken
        }
      });

    } catch (error) {
      next(error);
    }
  }

  /**
   * Verify email using token
   */
  static async verifyEmail(req, res, next) {
    try {
      const { token } = req.params;

      if (!token) {
        throw new AppError('Verification token is required', 400);
      }

      // Find user by verification token
      const user = await User.findOne({
        emailVerificationToken: token,
        emailVerificationExpires: { $gt: new Date() }
      });

      if (!user) {
        throw new AppError('Invalid or expired verification token', 400);
      }

      // Mark email as verified
      user.emailVerified = true;
      user.emailVerificationToken = null;
      user.emailVerificationExpires = null;
      await user.save();

      const app = await App.findOne({ owner: user._id }).select('_id name').lean();
      const integration = app?._id
        ? await Integration.findOne({ owner: app._id }).select('companyName primaryColor chatbotImage').lean()
        : null;
      const frontendBaseUrl = (process.env.FRONTEND_URL || process.env.CLIENT_APP_URL || '').replace(/\/$/, '');
      const logoUrl = integration?.chatbotImage?.filename
        ? `${frontendBaseUrl}/uploads/chatbots/${integration.chatbotImage.filename}`
        : '';

      await emailOrchestratorService.enqueueTemplateEmail({
        templateType: 'welcome_email',
        dedupeKey: `user:${String(user._id)}:welcome:v1`,
        toEmail: user.email,
        userId: user._id,
        appId: app?._id || null,
        payload: {
          userData: {
            email: user.email,
            firstName: user.firstName,
            name: `${user.firstName || ''} ${user.lastName || ''}`.trim(),
          },
          businessData: {
            appId: app?._id ? String(app._id) : undefined,
            companyName: integration?.companyName || app?.name || process.env.FROM_NAME || 'Assistly',
            name: integration?.companyName || app?.name || process.env.FROM_NAME || 'Assistly',
            primaryColor: integration?.primaryColor || undefined,
            logoUrl,
          },
          welcomeData: {
            dashboardUrl: `${frontendBaseUrl}/dashboard`,
            supportEmail: process.env.FROM_EMAIL || '',
          },
        },
      });

      // Generate JWT token for automatic login
      const jwt = require('jsonwebtoken');
      const authToken = jwt.sign(
        { userId: user._id, email: user.email },
        process.env.JWT_SECRET,
        { expiresIn: '7d' }
      );

      logger.info('Email verified successfully', { 
        userId: user._id, 
        email: user.email 
      });

      res.status(200).json({
        status: 'success',
        message: 'Email verified successfully',
        data: {
          user: user.getProfile(),
          token: authToken,
          tokenType: 'Bearer'
        }
      });

    } catch (error) {
      next(error);
    }
  }

  /**
   * Resend verification email
   */
  static async resendVerificationEmail(req, res, next) {
    try {
      const { email, htmlTemplate, templateData } = req.body;

      if (!email || (!htmlTemplate && !templateData?.htmlContent)) {
        throw new AppError('Email and HTML template are required', 400);
      }

      const htmlContent = htmlTemplate || templateData?.htmlContent;
      const textContent = templateData?.textContent;

      // Find user by email
      const user = await User.findByEmail(email);
      if (!user) {
        throw new AppError('User not found', 404);
      }

      if (user.emailVerified) {
        throw new AppError('Email is already verified', 400);
      }

      // Generate new verification token
      user.emailVerificationToken = uuidv4();
      user.emailVerificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
      await user.save();

      await emailOrchestratorService.enqueueTemplateEmail({
        templateType: 'verification_email',
        dedupeKey: `user:${String(user._id)}:verification:${String(user.emailVerificationToken)}`,
        toEmail: user.email,
        userId: user._id,
        payload: {
          userData: {
            email: user.email,
            firstName: user.firstName,
            verificationToken: user.emailVerificationToken
          },
          templateData: { htmlTemplate: htmlContent, textContent }
        }
      });

      logger.info('Verification email resent', { 
        userId: user._id, 
        email: user.email
      });

      res.status(200).json({
        status: 'success',
        message: 'Verification email resent successfully',
        data: {
          queued: true,
          expiresAt: user.emailVerificationExpires
        }
      });

    } catch (error) {
      next(error);
    }
  }

  /**
   * Send password reset email
   */
  static async sendPasswordResetEmail(req, res, next) {
    try {
      const { email, htmlTemplate, templateData } = req.body;

      if (!email || (!htmlTemplate && !templateData?.htmlContent)) {
        throw new AppError('Email and HTML template are required', 400);
      }

      // Support both formats: htmlTemplate (simple) and templateData (detailed)
      const htmlContent = htmlTemplate || templateData?.htmlContent;
      const textContent = templateData?.textContent;

      // Find user by email
      const user = await User.findByEmail(email);
      if (!user) {
        // Don't reveal if user exists or not for security
        logger.info('Password reset requested for non-existent email', { email });
        return res.status(200).json({
          status: 'success',
          message: 'If an account with this email exists, a password reset email has been sent'
        });
      }

      // Generate reset token
      user.passwordResetToken = uuidv4();
      user.passwordResetExpires = new Date(Date.now() + 1 * 60 * 60 * 1000); // 1 hour
      await user.save();

      await emailOrchestratorService.enqueueTemplateEmail({
        templateType: 'password_reset_email',
        dedupeKey: `user:${String(user._id)}:password-reset:${String(user.passwordResetToken)}`,
        toEmail: user.email,
        userId: user._id,
        payload: {
          userData: {
            email: user.email,
            firstName: user.firstName,
            resetToken: user.passwordResetToken
          },
          templateData: { htmlTemplate: htmlContent, textContent }
        }
      });

      logger.info('Password reset email sent', { 
        userId: user._id, 
        email: user.email
      });

      res.status(200).json({
        status: 'success',
        message: 'If an account with this email exists, a password reset email has been sent',
        data: {
          queued: true,
          expiresAt: user.passwordResetExpires
        }
      });

    } catch (error) {
      next(error);
    }
  }

  /**
   * Test email service configuration
   */
  static async testEmailService(req, res, next) {
    try {
      const isConfigured = await emailService.testConfiguration();
      
      if (isConfigured) {
        res.status(200).json({
          status: 'success',
          message: 'Email service is properly configured'
        });
      } else {
        throw new AppError('Email service configuration test failed', 500);
      }

    } catch (error) {
      next(error);
    }
  }

  static async sendgridEvents(req, res, next) {
    try {
      const events = Array.isArray(req.body) ? req.body : [];
      const result = await emailOrchestratorService.handleProviderEvents(events);
      res.status(200).json({ status: 'success', data: result });
    } catch (error) {
      next(error);
    }
  }

  static async appStats(req, res, next) {
    try {
      const appId = req.appId;
      const days = Math.min(365, Math.max(1, Number(req.query.days || 30)));
      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
      const appObjectId = new mongoose.Types.ObjectId(String(appId));

      const rows = await EmailJob.aggregate([
        { $match: { appId: appObjectId, createdAt: { $gte: since } } },
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            sent: { $sum: { $cond: [{ $eq: ['$status', 'sent'] }, 1, 0] } },
            delivered: { $sum: { $cond: [{ $eq: ['$finalStatus', 'delivered'] }, 1, 0] } },
            bounced: { $sum: { $cond: [{ $eq: ['$finalStatus', 'bounced'] }, 1, 0] } },
            dropped: { $sum: { $cond: [{ $eq: ['$finalStatus', 'dropped'] }, 1, 0] } },
            spamReported: { $sum: { $cond: [{ $eq: ['$finalStatus', 'spam_reported'] }, 1, 0] } },
            opens: { $sum: '$openCount' },
            clicks: { $sum: '$clickCount' },
          }
        }
      ]);

      const summary = rows[0] || {
        total: 0, sent: 0, delivered: 0, bounced: 0, dropped: 0, spamReported: 0, opens: 0, clicks: 0,
      };
      res.status(200).json({
        status: 'success',
        data: {
          days,
          ...summary,
          deliveryRate: summary.sent > 0 ? Number((summary.delivered / summary.sent).toFixed(4)) : 0,
          bounceRate: summary.sent > 0 ? Number((summary.bounced / summary.sent).toFixed(4)) : 0,
          spamRate: summary.sent > 0 ? Number((summary.spamReported / summary.sent).toFixed(4)) : 0,
        },
      });
    } catch (error) {
      next(error);
    }
  }
}

// Routes
router.post('/verify/send', EmailController.sendVerificationEmail);
router.post('/verify/resend', EmailController.resendVerificationEmail);
router.get('/verify/:token', EmailController.verifyEmail);
router.post('/password-reset/send', EmailController.sendPasswordResetEmail);
router.get('/test', authenticateToken, EmailController.testEmailService);
router.post('/events/sendgrid', EmailController.sendgridEvents);
router.get('/apps/:appId/stats', authenticateToken, requireUserOrAdmin, verifyAppOwnership, EmailController.appStats);

module.exports = router;
