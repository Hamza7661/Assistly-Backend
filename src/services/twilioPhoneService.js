const twilio = require('twilio');
const { logger } = require('../utils/logger');

/**
 * Fetch phone number pricing for a country directly from the Twilio Pricing REST API v1.
 * Uses a direct HTTPS request (bypasses the Twilio library pricing module which has
 * version-specific issues). Accepts explicit credentials so the caller can pass
 * whichever account SID/token is known to be valid.
 * @param {string} country - ISO 3166-1 alpha-2
 * @param {string} accountSid
 * @param {string} authToken
 * @returns {Promise<{ phoneNumberPrices: Array<{ number_type: string, base_price: string, current_price: string }>, priceUnit: string }>}
 */
function fetchTwilioPricing(country, accountSid, authToken) {
  return new Promise((resolve, reject) => {
    const auth = Buffer.from(`${accountSid}:${authToken}`).toString('base64');
    const https = require('https');
    const req = https.request(
      {
        hostname: 'pricing.twilio.com',
        path: `/v1/PhoneNumbers/Countries/${country}`,
        method: 'GET',
        headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' }
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
          if (res.statusCode === 200) {
            try { resolve(JSON.parse(body)); } catch { resolve(null); }
          } else {
            reject(new Error(`Twilio Pricing API ${res.statusCode}: ${body}`));
          }
        });
      }
    );
    req.on('error', reject);
    req.end();
  });
}

/**
 * Service for Twilio phone number operations: list available numbers by country,
 * purchase numbers, and assign the first available number (SMS+voice capable).
 */
class TwilioPhoneService {
  /**
   * @param {{ accountSid?: string, authToken?: string }} [config] - omit to use parent env credentials
   */
  constructor(config = {}) {
    const accountSid = config.accountSid || process.env.TWILIO_ACCOUNT_SID;
    const authToken = config.authToken || process.env.TWILIO_AUTH_TOKEN;
    if (!accountSid || !authToken) {
      throw new Error('TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN are required');
    }
    this.accountSid = accountSid;
    this.authToken = authToken;
    this.client = twilio(accountSid, authToken);
  }

  /**
   * Get available phone numbers for a country (SMS and voice capable for Meta verification).
   * - For GB (UK): uses "mobile" so accounts with a UK Mobile Regulatory Bundle get results.
   * - For other countries: uses "local" (geographic) numbers.
   * @param {string} countryCode - ISO 3166-1 alpha-2 (e.g. US, GB)
   * @param {Object} [options] - { limit, areaCode }
   * @returns {Promise<Array<{ phoneNumber: string, friendlyName?: string, capabilities: { sms: boolean, voice: boolean }, monthlyPrice?: string, priceUnit?: string }>>}
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

      // Fetch pricing via direct REST call using the same credentials this instance uses.
      // The subaccount credentials (from the app's stored token) are valid; the parent
      // credentials in .env may be stale — so we always use this.accountSid/authToken.
      const [numbersResult, pricingResult] = await Promise.allSettled([
        this.client.availablePhoneNumbers(country)[numberType].list(listOptions),
        fetchTwilioPricing(country, this.accountSid, this.authToken)
      ]);

      const numbers = numbersResult.status === 'fulfilled' ? numbersResult.value : (() => { throw numbersResult.reason; })();

      // Map each country to its natural display currency.
      // Twilio's pricing API returns price_unit as the *account's billing currency* (e.g. GBP
      // for a UK account), not the searched country's currency. We override it here so that
      // US numbers show USD ($), FR numbers show EUR (€), etc., regardless of billing currency.
      const COUNTRY_CURRENCY = {
        US: 'USD', GB: 'GBP', CA: 'CAD', AU: 'AUD', NZ: 'NZD',
        FR: 'EUR', DE: 'EUR', ES: 'EUR', IT: 'EUR', NL: 'EUR', BE: 'EUR',
        AT: 'EUR', PT: 'EUR', IE: 'EUR', FI: 'EUR', GR: 'EUR', SK: 'EUR',
        JP: 'JPY', CH: 'CHF', SE: 'SEK', NO: 'NOK', DK: 'DKK',
        SG: 'SGD', HK: 'HKD', IN: 'INR', BR: 'BRL', MX: 'MXN', ZA: 'ZAR',
      };

      // Extract monthly price for the relevant number type (non-fatal if pricing fails).
      // The raw Twilio Pricing REST API returns snake_case keys (phone_number_prices, price_unit).
      let monthlyPrice;
      let priceUnit = COUNTRY_CURRENCY[country] || null;
      if (pricingResult.status === 'fulfilled' && pricingResult.value) {
        const pricing = pricingResult.value;
        // Only fall back to API's price_unit if we have no country mapping
        if (!priceUnit) priceUnit = pricing.price_unit || pricing.priceUnit;
        const typeLabel = numberType === 'mobile' ? 'mobile' : 'local';
        const prices = pricing.phone_number_prices || pricing.phoneNumberPrices || [];
        const priceEntry = prices.find(
          (p) => p.number_type && p.number_type.toLowerCase() === typeLabel
        );
        if (priceEntry) {
          monthlyPrice = priceEntry.base_price || priceEntry.current_price;
        }
      } else if (pricingResult.status === 'rejected') {
        logger.warn('Twilio pricing fetch failed (non-fatal)', { country, error: pricingResult.reason?.message });
      }

      return (numbers || []).map((n) => ({
        phoneNumber: n.phoneNumber,
        friendlyName: n.friendlyName,
        capabilities: {
          sms: !!(n.capabilities && n.capabilities.SMS),
          voice: !!(n.capabilities && n.capabilities.voice)
        },
        monthlyPrice: monthlyPrice != null ? String(monthlyPrice) : undefined,
        priceUnit: priceUnit || undefined
      }));
    } catch (err) {
      logger.error('Twilio getAvailableNumbers failed', { country, error: err.message });
      throw err;
    }
  }

  /**
   * Purchase a phone number from Twilio on this client's account.
   * @param {string} phoneNumber - E.164 format (e.g. +14155551234)
   * @param {Object} [options] - { bundleSid, addressSid } for regulatory compliance
   * @returns {Promise<{ sid: string, phoneNumber: string }>}
   */
  async purchaseNumber(phoneNumber, options = {}) {
    const num = (phoneNumber || '').trim();
    if (!num || !num.startsWith('+')) {
      throw new Error('Phone number in E.164 format is required');
    }
    try {
      const createParams = { phoneNumber: num };
      if (options.bundleSid) createParams.bundleSid = options.bundleSid;
      if (options.addressSid) createParams.addressSid = options.addressSid;
      const incoming = await this.client.incomingPhoneNumbers.create(createParams);
      logger.info('Twilio number purchased', { sid: incoming.sid, phoneNumber: incoming.phoneNumber });
      return { sid: incoming.sid, phoneNumber: incoming.phoneNumber };
    } catch (err) {
      logger.error('Twilio purchaseNumber failed', { phoneNumber: num, error: err.message });
      throw err;
    }
  }

  /**
   * Purchase a number on the parent account (so the parent's regulatory bundle is accessible),
   * then transfer it to the subaccount using Twilio's ownership-transfer API.
   *
   * Twilio bundles are parent-account resources. If we try to buy with the bundle while scoped
   * to a subaccount, Twilio returns "Bundle not found". The correct flow per Twilio docs:
   *   1. POST /Accounts/{ParentSid}/IncomingPhoneNumbers → buy with bundleSid on parent
   *   2. POST /Accounts/{ParentSid}/IncomingPhoneNumbers/{Sid} AccountSid={SubSid} → transfer
   *
   * @param {string} phoneNumber - E.164 format
   * @param {string} subaccountSid - SID of the subaccount to transfer the number to
   * @param {Object} [options] - { bundleSid, addressSid }
   * @returns {Promise<{ sid: string, phoneNumber: string }>}
   */
  async purchaseNumberOnSubaccount(phoneNumber, subaccountSid, options = {}) {
    const num = (phoneNumber || '').trim();
    if (!num || !num.startsWith('+')) {
      throw new Error('Phone number in E.164 format is required');
    }
    if (!subaccountSid) {
      throw new Error('subaccountSid is required');
    }
    try {
      // Buy on parent account — bundle lives here so it's always found.
      // We intentionally keep the number on the parent account rather than transferring
      // to the subaccount, because Twilio requires the destination subaccount to also
      // have an approved regulatory bundle for UK Mobile numbers before it accepts the
      // transfer. Since subaccounts are created dynamically per app, they have no bundle.
      // For WhatsApp Business registration, the number only needs to exist in Twilio —
      // which account (parent vs subaccount) holds it does not affect Meta's flow.
      const createParams = { phoneNumber: num };
      if (options.bundleSid) createParams.bundleSid = options.bundleSid;
      if (options.addressSid) createParams.addressSid = options.addressSid;
      const incoming = await this.client.incomingPhoneNumbers.create(createParams);
      logger.info('Number purchased on parent account (GB regulatory bundle applied)', {
        sid: incoming.sid,
        phoneNumber: incoming.phoneNumber
      });
      return { sid: incoming.sid, phoneNumber: incoming.phoneNumber };
    } catch (err) {
      logger.error('Twilio purchaseNumberOnSubaccount failed', { phoneNumber: num, subaccountSid, error: err.message });
      throw err;
    }
  }

  /**
   * Get the first available SMS+voice number for a country and purchase it.
   * @param {string} countryCode - ISO 3166-1 alpha-2
   * @param {Object} [purchaseOptions] - { bundleSid, addressSid } for regulatory compliance
   * @returns {Promise<{ sid: string, phoneNumber: string } | null>}
   */
  async assignFirstAvailableNumber(countryCode, purchaseOptions = {}) {
    const list = await this.getAvailableNumbers(countryCode, { limit: 1 });
    if (!list || list.length === 0) {
      return null;
    }
    return this.purchaseNumber(list[0].phoneNumber, purchaseOptions);
  }
}

let instance = null;

function getTwilioPhoneService() {
  if (!instance) {
    instance = new TwilioPhoneService();
  }
  return instance;
}

function createTwilioPhoneServiceForAccount(accountSid, authToken) {
  return new TwilioPhoneService({ accountSid, authToken });
}

module.exports = {
  TwilioPhoneService,
  getTwilioPhoneService,
  createTwilioPhoneServiceForAccount
};
