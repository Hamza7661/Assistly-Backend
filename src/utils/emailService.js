const sgMail = require('@sendgrid/mail');
const { logger } = require('./logger');

class EmailService {
  constructor() {
    // Initialize SendGrid with API key from environment
    const apiKey = process.env.SENDGRID_API_KEY;
    if (!apiKey) {
      throw new Error('SENDGRID_API_KEY environment variable is required');
    }
    
    sgMail.setApiKey(apiKey);
    
    // Validate required environment variables
    if (!process.env.FROM_NAME || !process.env.FROM_EMAIL) {
      throw new Error('FROM_NAME and FROM_EMAIL environment variables are required');
    }
  }

  /**
   * Send email using template and content from frontend
   * @param {Object} emailData - Email data from frontend
   * @param {string} emailData.to - Recipient email
   * @param {string} emailData.subject - Email subject
   * @param {string} emailData.htmlContent - HTML content of the email
   * @param {string} emailData.textContent - Plain text content (optional)
   * @param {Object} emailData.dynamicTemplateData - Dynamic data for template (optional)
   * @param {string} emailData.templateId - SendGrid template ID (optional)
   * @returns {Promise<Object>} SendGrid response
   */
  async sendEmail(emailData) {
    try {
      const {
        to,
        subject,
        htmlContent,
        textContent,
        dynamicTemplateData,
        templateId
      } = emailData;

      // Validate required fields
      if (!to || !subject || !htmlContent) {
        throw new Error('to, subject, and htmlContent are required');
      }

      const msg = {
        to,
        from: {
          name: process.env.FROM_NAME,
          email: process.env.FROM_EMAIL
        },
        subject,
        html: htmlContent,
        ...(textContent && { text: textContent }),
        ...(templateId && { templateId }),
        ...(dynamicTemplateData && { dynamicTemplateData })
      };

      logger.info('Sending email', { to, subject, templateId: templateId || 'custom' });
      
      const response = await sgMail.send(msg);
      
      logger.info('Email sent successfully', { 
        to, 
        subject, 
        messageId: response[0]?.headers['x-message-id'] 
      });
      
      return {
        success: true,
        messageId: response[0]?.headers['x-message-id'],
        response
      };

    } catch (error) {
      logger.error('Failed to send email', { 
        error: error.message, 
        to: emailData?.to,
        subject: emailData?.subject 
      });
      
      throw new Error(`Email sending failed: ${error.message}`);
    }
  }

  /**
   * Send verification email specifically for user signup
   * @param {Object} userData - User data
   * @param {string} userData.email - User email
   * @param {string} userData.firstName - User first name
   * @param {string} userData.verificationToken - Email verification token
   * @param {Object} templateData - Template data from frontend
   * @returns {Promise<Object>} SendGrid response
   */
  async sendVerificationEmail(userData, templateData) {
    const { email, firstName, verificationToken } = userData;
    
    if (!verificationToken) {
      throw new Error('Verification token is required');
    }

    if (!templateData.htmlTemplate) {
      throw new Error('HTML template is required');
    }

    // Replace placeholders in HTML content with real data
    let htmlContent = templateData.htmlTemplate;
    let textContent = templateData.textContent;

    // Replace verification token placeholders
    if (htmlContent) {
      htmlContent = htmlContent
        .replace(/{{VERIFICATION_TOKEN}}/g, verificationToken)
        .replace(/temp-token-\d+/g, verificationToken) // Replace temp tokens
        .replace(/{{FIRST_NAME}}/g, firstName || 'User');
    }

    if (textContent) {
      textContent = textContent
        .replace(/{{VERIFICATION_TOKEN}}/g, verificationToken)
        .replace(/temp-token-\d+/g, verificationToken) // Replace temp tokens
        .replace(/{{FIRST_NAME}}/g, firstName || 'User');
    }

    // Frontend provides complete HTML content, backend just sends it
    const emailData = {
      to: email,
      subject: process.env.EMAIL_VERIFICATION_SUBJECT || 'Verify Your Email - Assistly',
      htmlContent: htmlContent,
      textContent: textContent,
      templateId: templateData.templateId
    };



    return this.sendEmail(emailData);
  }

  /**
   * Send password reset email
   * @param {Object} userData - User data
   * @param {string} userData.email - User email
   * @param {string} userData.firstName - User first name
   * @param {string} userData.resetToken - Password reset token
   * @param {Object} templateData - Template data from frontend
   * @returns {Promise<Object>} SendGrid response
   */
  async sendPasswordResetEmail(userData, templateData) {
    const { email, firstName, resetToken } = userData;
    
    if (!resetToken) {
      throw new Error('Reset token is required');
    }

    // Replace placeholders in HTML content with real data
    let htmlContent = templateData.htmlTemplate;
    let textContent = templateData.textContent;

    // Replace reset token placeholders
    if (htmlContent) {
      htmlContent = htmlContent
        .replace(/{{RESET_TOKEN}}/g, resetToken)
        .replace(/temp-token-\d+/g, resetToken) // Replace temp tokens
        .replace(/{{FIRST_NAME}}/g, firstName || 'User');
    }

    if (textContent) {
      textContent = textContent
        .replace(/{{RESET_TOKEN}}/g, resetToken)
        .replace(/temp-token-\d+/g, resetToken) // Replace temp tokens
        .replace(/{{FIRST_NAME}}/g, firstName || 'User');
    }

    const emailData = {
      to: email,
      subject: process.env.EMAIL_PASSWORD_RESET_SUBJECT || 'Reset Your Password - Assistly',
      htmlContent: htmlContent,
      textContent: textContent,
      templateId: templateData.templateId
    };

    return this.sendEmail(emailData);
  }

  /**
   * Test email service configuration
   * @returns {Promise<boolean>} True if configuration is valid
   */
  async testConfiguration() {
    try {
      // Test API key by making a simple request
      const response = await sgMail.send({
        to: 'test@example.com',
        from: {
          name: process.env.FROM_NAME,
          email: process.env.FROM_EMAIL
        },
        subject: 'Test Email',
        html: '<p>This is a test email</p>'
      });
      
      logger.info('Email service configuration test successful');
      return true;
    } catch (error) {
      logger.error('Email service configuration test failed', { error: error.message });
      return false;
    }
  }
}

module.exports = EmailService;
