const twilio = require('twilio');
const { logger } = require('./logger');

class SmsService {
  constructor() {
    // Initialize Twilio with credentials from environment
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const fromNumber = process.env.TWILIO_FROM_NUMBER;
    
    if (!accountSid || !authToken || !fromNumber) {
      throw new Error('TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_FROM_NUMBER environment variables are required');
    }
    
    this.client = twilio(accountSid, authToken);
    this.fromNumber = fromNumber;
  }

  /**
   * Send OTP SMS for customer validation
   * @param {Object} userData - User data
   * @param {string} userData.phoneNumber - Customer phone number
   * @param {string} userData.firstName - Customer first name
   * @param {string} userData.otp - OTP code
   * @returns {Promise<Object>} Twilio response
   */
  async sendOtpSms(userData) {
    const { phoneNumber, firstName, otp } = userData;
    
    if (!otp) {
      throw new Error('OTP code is required');
    }

    if (!phoneNumber) {
      throw new Error('Phone number is required');
    }

    // Format phone number (ensure it starts with +)
    const formattedNumber = phoneNumber.startsWith('+') ? phoneNumber : `+${phoneNumber}`;

    // Create SMS message
    const message = `Your verification code is: ${otp}. This code will expire in 10 minutes. - ${process.env.FROM_NAME || 'Assistly'}`;

    try {
      logger.info('Sending OTP SMS', { phoneNumber: formattedNumber });
      
      const response = await this.client.messages.create({
        body: message,
        from: this.fromNumber,
        to: formattedNumber
      });
      
      logger.info('OTP SMS sent successfully', { 
        phoneNumber: formattedNumber,
        messageSid: response.sid 
      });
      
      return {
        success: true,
        messageSid: response.sid,
        status: response.status,
        response
      };

    } catch (error) {
      logger.error('Failed to send OTP SMS', { 
        error: error.message, 
        phoneNumber: formattedNumber 
      });
      
      throw new Error(`SMS sending failed: ${error.message}`);
    }
  }

  /**
   * Test SMS service configuration
   * @returns {Promise<boolean>} True if configuration is valid
   */
  async testConfiguration() {
    try {
      // Test by getting account info
      const account = await this.client.api.accounts(this.client.accountSid).fetch();
      
      logger.info('SMS service configuration test successful', { 
        accountSid: account.sid,
        status: account.status 
      });
      return true;
    } catch (error) {
      logger.error('SMS service configuration test failed', { error: error.message });
      return false;
    }
  }

  /**
   * Validate phone number format
   * @param {string} phoneNumber - Phone number to validate
   * @returns {boolean} True if valid format
   */
  static validatePhoneNumber(phoneNumber) {
    // E.164 format: +[country code][number]
    const phoneRegex = /^\+[1-9]\d{1,14}$/;
    return phoneRegex.test(phoneNumber);
  }
}

module.exports = SmsService;
