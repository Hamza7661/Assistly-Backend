const sgMail = require('@sendgrid/mail');
const { logger } = require('./logger');
const {
  getCompanyTheme,
  buildCustomerConfirmationHtml,
  buildBusinessNotificationHtml,
  buildFacelismVerificationCodeHtml,
} = require('./emailTemplates');

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
        templateId,
        fromName,
        fromEmail,
      } = emailData;

      // Validate required fields
      if (!to || !subject || !htmlContent) {
        throw new Error('to, subject, and htmlContent are required');
      }

      const resolvedFromName =
        fromName !== undefined && fromName !== null && String(fromName).trim() !== ''
          ? String(fromName).trim()
          : process.env.FROM_NAME;
      const resolvedFromEmail = (fromEmail && String(fromEmail).trim()) || process.env.FROM_EMAIL;

      const msg = {
        to,
        from: {
          name: resolvedFromName,
          email: resolvedFromEmail
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
      subject: process.env.EMAIL_VERIFICATION_SUBJECT || 'Verify Your Email - UpZilo',
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
      subject: process.env.EMAIL_PASSWORD_RESET_SUBJECT || 'Reset Your Password - UpZilo',
      htmlContent: htmlContent,
      textContent: textContent,
      templateId: templateData.templateId
    };

    return this.sendEmail(emailData);
  }

  /**
   * Send OTP email for customer validation
   * @param {Object} userData - User data
   * @param {string} userData.email - Customer email
   * @param {string} userData.firstName - Customer first name
   * @param {string} userData.otp - OTP code
   * @param {Object} templateData - Template data from frontend
   * @returns {Promise<Object>} SendGrid response
   */
  async sendOtpEmail(userData, templateData) {
    const { email, firstName, otp } = userData;
    
    if (!otp) {
      throw new Error('OTP code is required');
    }

    const rawBrand =
      templateData?.branding ||
      templateData?.brand ||
      templateData?.companyName ||
      '';
    const normalizedBrand = String(rawBrand).trim().toLowerCase();
    const isFacelismBranding =
      normalizedBrand === 'facelism' ||
      normalizedBrand === 'facelism luxe' ||
      normalizedBrand.replace(/[^a-z0-9]/g, '') === 'facelism';

    if (!templateData.htmlTemplate && !isFacelismBranding) {
      throw new Error('HTML template is required');
    }

    // Replace placeholders in HTML content with real data
    let htmlContent = templateData.htmlTemplate;
    let textContent = templateData.textContent;

    if (isFacelismBranding) {
      htmlContent = buildFacelismVerificationCodeHtml({
        customerName: firstName || 'Customer',
        otp,
        supportEmail: templateData?.supportEmail || 'support@facelism.com',
      });
      textContent =
        textContent ||
        `Hello ${firstName || 'Customer'}, your Facelism verification code is ${otp}. This code will expire in 10 minutes.`;
    }

    // Replace OTP placeholders
    if (htmlContent) {
      htmlContent = htmlContent
        .replace(/{{OTP}}/g, otp)
        .replace(/{{FIRST_NAME}}/g, firstName || 'Customer');
    }

    if (textContent) {
      textContent = textContent
        .replace(/{{OTP}}/g, otp)
        .replace(/{{FIRST_NAME}}/g, firstName || 'Customer');
    }

    const emailData = {
      to: email,
      subject: isFacelismBranding
        ? (process.env.EMAIL_OTP_SUBJECT_FACELISM || 'Your Verification Code - Facelism')
        : (process.env.EMAIL_OTP_SUBJECT || 'Your Verification Code - UpZilo'),
      htmlContent: htmlContent,
      textContent: textContent,
      templateId: templateData.templateId,
      ...(isFacelismBranding ? { fromName: process.env.FACELISM_FROM_NAME || 'Facelism' } : {})
    };

    return this.sendEmail(emailData);
  }

  async sendAppointmentConfirmationEmail(customerData, appointmentData, businessData = {}) {
    const customerName = customerData?.name || 'Customer';
    const customerEmail = customerData?.email;
    if (!customerEmail) throw new Error('Customer email is required');

    const companyName = businessData?.companyName || businessData?.name || process.env.FROM_NAME || 'Our Team';
    const serviceName = appointmentData?.serviceName || appointmentData?.title || 'Appointment';
    const startText = appointmentData?.startText || '';
    const endText = appointmentData?.endText || '';
    const calendarLink = appointmentData?.link || '';
    const postBookingNote = appointmentData?.postBookingNote || '';

    const theme = getCompanyTheme(companyName, {
      primaryColor: businessData?.primaryColor,
      logoUrl: businessData?.logoUrl,
    });

    const htmlContent = buildCustomerConfirmationHtml({
      customerName,
      serviceName,
      startText,
      endText,
      calendarLink,
      postBookingNote,
      theme,
    });

    return this.sendEmail({
      to: customerEmail,
      subject: `Appointment Confirmed – ${serviceName} | ${companyName}`,
      htmlContent,
      textContent: `Hi ${customerName}, your ${serviceName} appointment with ${companyName} is confirmed for ${startText}. We look forward to seeing you!`,
      // In inbox, show the business brand (e.g. "Facelism") when SendGrid allows this display name on your domain.
      fromName: companyName,
    });
  }

  async sendAppointmentBusinessNotificationEmail(businessData, customerData, appointmentData) {
    const businessEmail = businessData?.email;
    if (!businessEmail) throw new Error('Business email is required');

    const companyName = businessData?.companyName || businessData?.name || 'Business';
    const customerName = customerData?.name || 'Customer';
    const customerEmail = customerData?.email || 'Not provided';
    const customerPhone = customerData?.phone || 'Not provided';
    const serviceName = appointmentData?.serviceName || appointmentData?.title || 'Appointment';
    const startText = appointmentData?.startText || '';
    const endText = appointmentData?.endText || '';
    const calendarLink = appointmentData?.link || '';

    const theme = getCompanyTheme(companyName, {
      primaryColor: businessData?.primaryColor,
      logoUrl: businessData?.logoUrl,
    });

    const htmlContent = buildBusinessNotificationHtml({
      businessName: companyName,
      customerName,
      customerEmail,
      customerPhone,
      serviceName,
      startText,
      endText,
      calendarLink,
      theme,
    });

    const alertFromName =
      process.env.BOOKING_ALERT_FROM_NAME ||
      process.env.FROM_NAME ||
      'UpZilo';

    return this.sendEmail({
      to: businessEmail,
      subject: `New Appointment – ${serviceName} (${customerName})`,
      htmlContent,
      textContent: `New appointment booked: ${serviceName} at ${startText}. Customer: ${customerName} | ${customerEmail} | ${customerPhone}.`,
      fromName: alertFromName,
    });
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
