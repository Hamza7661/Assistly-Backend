const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { logger } = require('../utils/logger');
const { AppError } = require('../utils/errorHandler');
const { User } = require('../models/User');
const EmailService = require('../utils/emailService');
const { authenticateToken } = require('../middleware/auth');

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

      // Support both formats: htmlTemplate (simple) and templateData (detailed)
      const htmlContent = htmlTemplate;
      const textContent = templateData?.textContent;

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

      // Send verification email using frontend template
      const emailResult = await emailService.sendVerificationEmail(
        {
          email: user.email,
          firstName: user.firstName,
          verificationToken: user.emailVerificationToken
        },
        { htmlTemplate: htmlContent, textContent }
      );

      logger.info('Verification email sent', { 
        userId: user._id, 
        email: user.email,
        messageId: emailResult.messageId 
      });

      res.status(200).json({
        status: 'success',
        message: 'Verification email sent successfully',
        data: {
          messageId: emailResult.messageId,
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

      // Support both formats: htmlTemplate (simple) and templateData (detailed)
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

      // Send verification email using frontend template
      const emailResult = await emailService.sendVerificationEmail(
        {
          email: user.email,
          firstName: user.firstName,
          verificationToken: user.emailVerificationToken
        },
        { htmlContent, textContent }
      );

      logger.info('Verification email resent', { 
        userId: user._id, 
        email: user.email,
        messageId: emailResult.messageId 
      });

      res.status(200).json({
        status: 'success',
        message: 'Verification email resent successfully',
        data: {
          messageId: emailResult.messageId,
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

      // Send password reset email using frontend template
      const emailResult = await emailService.sendPasswordResetEmail(
        {
          email: user.email,
          firstName: user.firstName,
          resetToken: user.passwordResetToken
        },
        { htmlContent, textContent }
      );

      logger.info('Password reset email sent', { 
        userId: user._id, 
        email: user.email,
        messageId: emailResult.messageId 
      });

      res.status(200).json({
        status: 'success',
        message: 'If an account with this email exists, a password reset email has been sent',
        data: {
          messageId: emailResult.messageId,
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
}

// Routes
router.post('/verify/send', EmailController.sendVerificationEmail);
router.post('/verify/resend', EmailController.resendVerificationEmail);
router.get('/verify/:token', EmailController.verifyEmail);
router.post('/password-reset/send', EmailController.sendPasswordResetEmail);
router.get('/test', authenticateToken, EmailController.testEmailService);

module.exports = router;
