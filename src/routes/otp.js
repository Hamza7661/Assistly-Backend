const express = require('express');
const router = express.Router();
const { Otp, sendEmailOtpValidationSchema, sendSmsOtpValidationSchema, verifyOtpValidationSchema } = require('../models/Otp');
const { logger } = require('../utils/logger');
const { AppError } = require('../utils/errorHandler');
const { verifySignedThirdPartyForParamUser } = require('../middleware/thirdParty');
const EmailService = require('../utils/emailService');
const SmsService = require('../utils/smsService');
const { Integration } = require('../models/Integration');
const { App } = require('../models/App');
const crypto = require('crypto');
const { AppSubscriptionState } = require('../models/AppSubscriptionState');
const { AppSubscriptionStateService } = require('../services/appSubscriptionStateService');


class OtpController {
  constructor() {
    this.emailService = new EmailService();
    this.smsService = new SmsService();
  }

  /**
   * Generate a random OTP code
   * @param {number} length - Length of OTP (default: 6)
   * @returns {string} Generated OTP
   */
  static generateOtp(length = 6) {
    const digits = '0123456789';
    let otp = '';
    for (let i = 0; i < length; i++) {
      otp += digits[Math.floor(Math.random() * digits.length)];
    }
    return otp;
  }

  /**
   * Send OTP to customer email
   * POST /api/v1/otp/send-email
   */
  async sendEmailOtp(req, res, next) {
    try {
      const { id: userId } = req.params;
      const { email, htmlTemplate, supportEmail, companyName, appId, customerName } = req.body;

      // Validate request body
      const { error } = sendEmailOtpValidationSchema.validate({ email });
      if (error) {
        return next(new AppError(error.details[0].message, 400));
      }

      if (!htmlTemplate) {
        return next(new AppError('HTML template is required', 400));
      }

      // Generate OTP
      const otp = OtpController.generateOtp();
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

      // Delete any existing unverified OTPs for this user/email
      await Otp.deleteMany({
        userId,
        type: 'email',
        target: email,
        isVerified: false
      });

      // Create new OTP record
      const otpRecord = new Otp({
        userId,
        type: 'email',
        target: email,
        otp,
        expiresAt
      });

      await otpRecord.save();

      // Resolve brand config from the app's Integration record (same pattern as calendar.js).
      // Request-body values are accepted only as a last resort (no appId provided).
      const trimmedAppId = String(appId || '').trim();
      let resolvedCompanyName = String(companyName || '').trim();
      let resolvedPrimaryColor = '';
      let resolvedLogoUrl = '';
      let resolvedSupportEmail = String(supportEmail || '').trim();

      if (trimmedAppId) {
        try {
          const [integration, app] = await Promise.all([
            Integration.findOne({ owner: trimmedAppId })
              .select('companyName primaryColor chatbotImage')
              .lean(),
            App.findById(trimmedAppId).select('name').lean(),
          ]);

          resolvedCompanyName =
            integration?.companyName || app?.name || resolvedCompanyName || '';
          resolvedPrimaryColor = integration?.primaryColor || '';
          resolvedLogoUrl = integration?.chatbotImage?.filename
            ? `${process.env.NEXT_PUBLIC_API_URL || ''}/api/v1/integration/public/apps/${trimmedAppId}/chatbot-image`
            : '';
        } catch (resolveError) {
          logger.warn('Failed to resolve OTP brand config from appId', {
            appId: trimmedAppId,
            error: resolveError.message,
          });
        }
      }

      const resolvedCustomerName = String(customerName || '').trim();
      const emailData = {
        email,
        firstName: resolvedCustomerName || 'Customer',
        otp,
      };

      const templateData = {
        htmlTemplate,
        appId: trimmedAppId || undefined,
        companyName: resolvedCompanyName,
        primaryColor: resolvedPrimaryColor,
        logoUrl: resolvedLogoUrl,
        supportEmail: resolvedSupportEmail,
      };

      await this.emailService.sendOtpEmail(emailData, templateData);

      logger.info('Email OTP sent successfully', { userId, email });

      res.status(200).json({
        status: 'success',
        message: 'OTP sent to email successfully',
        data: {
          email,
          expiresIn: '10 minutes'
        }
      });

    } catch (error) {
      logger.error('Failed to send email OTP', { 
        error: error.message, 
        userId: req.params.id,
        email: req.body.email 
      });
      next(new AppError('Failed to send email OTP', 500));
    }
  }

  /**
   * Send OTP to customer phone number
   * POST /api/v1/otp/send-sms
   */
  async sendSmsOtp(req, res, next) {
    try {
      const { id: userId } = req.params;
      const { phoneNumber, appId } = req.body;

      // Validate request body
      const { error } = sendSmsOtpValidationSchema.validate({ phoneNumber });
      if (error) {
        return next(new AppError(error.details[0].message, 400));
      }

      // Validate phone number format
      if (!SmsService.validatePhoneNumber(phoneNumber)) {
        return next(new AppError('Invalid phone number format. Use E.164 format (e.g., +1234567890)', 400));
      }

      // SMS verification is controlled via paid add-on in app subscription state.
      if (!appId) {
        return next(new AppError('appId is required for SMS verification', 400));
      }
      const app = await App.findById(appId).select('_id owner').lean();
      if (!app || String(app.owner) !== String(userId)) {
        return next(new AppError('Invalid appId for this user', 403));
      }
      const ensured = await AppSubscriptionStateService.ensureStateForApp(appId);
      const summary = AppSubscriptionStateService.summarize(ensured);
      if (!summary?.isActive) {
        return next(new AppError('Subscription is not active for SMS verification', 403));
      }
      const smsAddon = ensured?.addons?.smsVerification || {};
      if (!smsAddon.enabled) {
        return next(new AppError('SMS verification add-on is not enabled for this app', 403));
      }
      if ((smsAddon.limit || 0) > 0 && (smsAddon.used || 0) >= smsAddon.limit) {
        return next(new AppError('SMS verification add-on limit reached', 409));
      }

      // Generate OTP
      const otp = OtpController.generateOtp();
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

      // Delete any existing unverified OTPs for this user/phone
      await Otp.deleteMany({
        userId,
        type: 'sms',
        target: phoneNumber,
        isVerified: false
      });

      // Create new OTP record
      const otpRecord = new Otp({
        userId,
        type: 'sms',
        target: phoneNumber,
        otp,
        expiresAt
      });

      await otpRecord.save();

      // Send SMS
      const smsData = {
        phoneNumber,
        firstName: 'Customer', // Could be enhanced to get from user data
        otp
      };

      await this.smsService.sendOtpSms(smsData);

      const updatedState = await AppSubscriptionState.findOneAndUpdate(
        {
          appId,
          'addons.smsVerification.enabled': true,
          $or: [
            { 'addons.smsVerification.limit': { $lte: 0 } },
            { $expr: { $lt: ['$addons.smsVerification.used', '$addons.smsVerification.limit'] } }
          ]
        },
        {
          $inc: {
            'addons.smsVerification.used': 1,
            'usage.smsVerificationUsed': 1
          }
        },
        { new: true }
      );
      if (updatedState) {
        await AppSubscriptionStateService.logEvent(updatedState, {
          eventType: 'usage_consumed',
          actorType: 'ai',
          metadata: { usageType: 'sms_verification', appId }
        });
      }

      logger.info('SMS OTP sent successfully', { userId, phoneNumber });

      res.status(200).json({
        status: 'success',
        message: 'OTP sent to phone number successfully',
        data: {
          phoneNumber,
          expiresIn: '10 minutes'
        }
      });

    } catch (error) {
      logger.error('Failed to send SMS OTP', { 
        error: error.message, 
        userId: req.params.id,
        phoneNumber: req.body.phoneNumber 
      });
      next(new AppError('Failed to send SMS OTP', 500));
    }
  }

  /**
   * Verify email OTP
   * POST /api/v1/otp/verify-email
   */
  async verifyEmailOtp(req, res, next) {
    try {
      const { id: userId } = req.params;
      const { email, otp } = req.body;

      if (!email || !otp) {
        return next(new AppError('Email and OTP are required', 400));
      }

      // Find the OTP record
      const otpRecord = await Otp.findOne({
        userId,
        type: 'email',
        target: email,
        isVerified: false
      });

      if (!otpRecord) {
        return next(new AppError('Invalid or expired OTP', 400));
      }

      // Check if OTP has expired
      if (new Date() > otpRecord.expiresAt) {
        await Otp.deleteOne({ _id: otpRecord._id });
        return next(new AppError('OTP has expired', 400));
      }

      // Check attempts limit
      if (otpRecord.attempts >= 3) {
        await Otp.deleteOne({ _id: otpRecord._id });
        return next(new AppError('Maximum attempts exceeded', 400));
      }

      // Increment attempts
      otpRecord.attempts += 1;

      // Verify OTP
      if (otpRecord.otp !== otp) {
        await otpRecord.save();
        return next(new AppError('Invalid OTP', 400));
      }

      // Mark as verified
      otpRecord.isVerified = true;
      otpRecord.verifiedAt = new Date();
      await otpRecord.save();

      logger.info('Email OTP verified successfully', { userId, email });

      res.status(200).json({
        status: 'success',
        message: 'Email OTP verified successfully',
        data: {
          email,
          verifiedAt: otpRecord.verifiedAt
        }
      });

    } catch (error) {
      logger.error('Failed to verify email OTP', { 
        error: error.message, 
        userId: req.params.id,
        email: req.body.email 
      });
      next(new AppError('Failed to verify email OTP', 500));
    }
  }

  /**
   * Verify SMS OTP
   * POST /api/v1/otp/verify-sms
   */
  async verifySmsOtp(req, res, next) {
    try {
      const { id: userId } = req.params;
      const { phoneNumber, otp } = req.body;

      if (!phoneNumber || !otp) {
        return next(new AppError('Phone number and OTP are required', 400));
      }

      // Find the OTP record
      const otpRecord = await Otp.findOne({
        userId,
        type: 'sms',
        target: phoneNumber,
        isVerified: false
      });

      if (!otpRecord) {
        return next(new AppError('Invalid or expired OTP', 400));
      }

      // Check if OTP has expired
      if (new Date() > otpRecord.expiresAt) {
        await Otp.deleteOne({ _id: otpRecord._id });
        return next(new AppError('OTP has expired', 400));
      }

      // Check attempts limit
      if (otpRecord.attempts >= 3) {
        await Otp.deleteOne({ _id: otpRecord._id });
        return next(new AppError('Maximum attempts exceeded', 400));
      }

      // Increment attempts
      otpRecord.attempts += 1;

      // Verify OTP
      if (otpRecord.otp !== otp) {
        await otpRecord.save();
        return next(new AppError('Invalid OTP', 400));
      }

      // Mark as verified
      otpRecord.isVerified = true;
      otpRecord.verifiedAt = new Date();
      await otpRecord.save();

      logger.info('SMS OTP verified successfully', { userId, phoneNumber });

      res.status(200).json({
        status: 'success',
        message: 'SMS OTP verified successfully',
        data: {
          phoneNumber,
          verifiedAt: otpRecord.verifiedAt
        }
      });

    } catch (error) {
      logger.error('Failed to verify SMS OTP', { 
        error: error.message, 
        userId: req.params.id,
        phoneNumber: req.body.phoneNumber 
      });
      next(new AppError('Failed to verify SMS OTP', 500));
    }
  }

  /**
   * Get OTP status for a user
   * GET /api/v1/otp/status/:id
   */
  async getOtpStatus(req, res, next) {
    try {
      const { id: userId } = req.params;

      // Get all verified OTPs for this user
      const verifiedOtps = await Otp.find({
        userId,
        isVerified: true
      }).select('type target verifiedAt createdAt').sort({ verifiedAt: -1 });

      const emailVerification = verifiedOtps.find(otp => otp.type === 'email');
      const smsVerification = verifiedOtps.find(otp => otp.type === 'sms');

      res.status(200).json({
        status: 'success',
        data: {
          email: emailVerification ? {
            verified: true,
            email: emailVerification.target,
            verifiedAt: emailVerification.verifiedAt
          } : { verified: false },
          sms: smsVerification ? {
            verified: true,
            phoneNumber: smsVerification.target,
            verifiedAt: smsVerification.verifiedAt
          } : { verified: false }
        }
      });

    } catch (error) {
      logger.error('Failed to get OTP status', { 
        error: error.message, 
        userId: req.params.id 
      });
      next(new AppError('Failed to get OTP status', 500));
    }
  }
}

const otpController = new OtpController();

// Routes - bind methods to preserve 'this' context
router.post('/send-email/:id', verifySignedThirdPartyForParamUser, otpController.sendEmailOtp.bind(otpController));
router.post('/send-sms/:id', verifySignedThirdPartyForParamUser, otpController.sendSmsOtp.bind(otpController));
router.post('/verify-email/:id', verifySignedThirdPartyForParamUser, otpController.verifyEmailOtp.bind(otpController));
router.post('/verify-sms/:id', verifySignedThirdPartyForParamUser, otpController.verifySmsOtp.bind(otpController));
router.get('/status/:id', verifySignedThirdPartyForParamUser, otpController.getOtpStatus.bind(otpController));

module.exports = router;
