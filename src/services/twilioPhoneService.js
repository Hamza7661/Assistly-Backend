const twilio = require('twilio');
const { logger } = require('../utils/logger');

/**
 * Service for Twilio phone number operations: list available numbers by country,
 * purchase numbers, and assign the first available number (SMS+voice capable).
 */
class TwilioPhoneService {
  constructor() {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    if (!accountSid || !authToken) {
      throw new Error('TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN are required');
    }
    this.client = twilio(accountSid, authToken);
  }

  /**
   * Get available phone numbers for a country (SMS and voice capable for Meta verification).
   * - For GB (UK): uses "mobile" so accounts with a UK Mobile Regulatory Bundle get results.
   * - For other countries: uses "local" (geographic) numbers.
   * @param {string} countryCode - ISO 3166-1 alpha-2 (e.g. US, GB)
   * @param {Object} [options] - { limit, areaCode }
   * @returns {Promise<Array<{ phoneNumber: string, friendlyName?: string }>>}
   */
  async getAvailableNumbers(countryCode, options = {}) {
    const { limit = 20, areaCode } = options;
    const country = (countryCode || '').toUpperCase().trim();
    if (!country || country.length !== 2) {
      throw new Error('Valid ISO country code (e.g. US, GB) is required');
    }
    try {
      const listOptions = {
        limit,
        smsEnabled: true,
        voiceEnabled: true
      };
      if (areaCode) listOptions.areaCode = areaCode;
      // UK (GB) often requires a Mobile Regulatory Bundle; use mobile so users with that bundle get numbers
      const numberType = country === 'GB' ? 'mobile' : 'local';
      const numbers = await this.client.availablePhoneNumbers(country)
        [numberType]
        .list(listOptions);
      return (numbers || []).map((n) => ({
        phoneNumber: n.phoneNumber,
        friendlyName: n.friendlyName
      }));
    } catch (err) {
      logger.error('Twilio getAvailableNumbers failed', { country, error: err.message });
      throw err;
    }
  }

  /**
   * Purchase a phone number from Twilio.
   * @param {string} phoneNumber - E.164 format (e.g. +14155551234)
   * @returns {Promise<{ sid: string, phoneNumber: string }>}
   */
  async purchaseNumber(phoneNumber) {
    const num = (phoneNumber || '').trim();
    if (!num || !num.startsWith('+')) {
      throw new Error('Phone number in E.164 format is required');
    }
    try {
      const incoming = await this.client.incomingPhoneNumbers.create({ phoneNumber: num });
      logger.info('Twilio number purchased', { sid: incoming.sid, phoneNumber: incoming.phoneNumber });
      return { sid: incoming.sid, phoneNumber: incoming.phoneNumber };
    } catch (err) {
      logger.error('Twilio purchaseNumber failed', { phoneNumber: num, error: err.message });
      throw err;
    }
  }

  /**
   * Get the first available SMS+voice number for a country and purchase it.
   * @param {string} countryCode - ISO 3166-1 alpha-2
   * @returns {Promise<{ sid: string, phoneNumber: string } | null>}
   */
  async assignFirstAvailableNumber(countryCode) {
    const list = await this.getAvailableNumbers(countryCode, { limit: 1 });
    if (!list || list.length === 0) {
      return null;
    }
    return this.purchaseNumber(list[0].phoneNumber);
  }
}

let instance = null;

function getTwilioPhoneService() {
  if (!instance) {
    instance = new TwilioPhoneService();
  }
  return instance;
}

module.exports = {
  TwilioPhoneService,
  getTwilioPhoneService
};
