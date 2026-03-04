const twilio = require('twilio');
const { logger } = require('../utils/logger');

/**
 * Service for Twilio Messaging Senders API (WhatsApp): create sender, submit verification code,
 * and fetch sender status. Uses v2 Channels Senders API.
 */
class WhatsAppSenderService {
  constructor() {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    if (!accountSid || !authToken) {
      throw new Error('TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN are required');
    }
    this.client = twilio(accountSid, authToken);
  }

  /**
   * Normalize phone to E.164 and build sender_id for WhatsApp channel.
   * @param {string} phoneNumber - E.164 or raw number
   * @returns {string} whatsapp:+1234567890
   */
  _senderId(phoneNumber) {
    const num = (phoneNumber || '').trim();
    if (!num) throw new Error('Phone number is required');
    const normalized = num.startsWith('+') ? num : `+${num}`;
    return `whatsapp:${normalized}`;
  }

  /**
   * Create and register a WhatsApp sender (Twilio Senders API v2).
   * For Twilio-provided numbers verification is automatic; for user-provided numbers
   * the sender is created in PENDING_VERIFICATION and the user must submit the OTP later.
   * @param {string} phoneNumber - E.164 format
   * @param {Object} options - { wabaId?, statusCallbackUrl?, profileName?, verificationMethod? }
   * @returns {Promise<{ sid: string, status: string, sender_id: string }>}
   */
  async createSender(phoneNumber, options = {}) {
    const { wabaId, statusCallbackUrl, profileName, verificationMethod = 'sms' } = options;
    const senderId = this._senderId(phoneNumber);

    const payload = {
      sender_id: senderId,
      configuration: {
        verification_method: verificationMethod
      },
      profile: {
        name: profileName || 'Business'
      }
    };

    if (wabaId) {
      payload.configuration.waba_id = String(wabaId).trim();
    }

    if (statusCallbackUrl) {
      payload.webhook = {
        status_callback_url: statusCallbackUrl,
        status_callback_method: 'POST'
      };
    }

    try {
      const sender = await this.client.messaging.v2.channelsSenders.create(payload);
      logger.info('Twilio WhatsApp sender created', {
        sid: sender.sid,
        sender_id: sender.senderId,
        status: sender.status
      });
      return {
        sid: sender.sid,
        status: sender.status,
        sender_id: sender.senderId
      };
    } catch (err) {
      logger.error('Twilio createSender failed', { phoneNumber: senderId, error: err.message });
      throw err;
    }
  }

  /**
   * Submit verification code for a sender in PENDING_VERIFICATION (user-provided numbers).
   * @param {string} senderSid - Twilio sender SID (e.g. XE...)
   * @param {string} verificationCode - OTP from Meta/Twilio
   * @returns {Promise<{ sid: string, status: string }>}
   */
  async submitVerificationCode(senderSid, verificationCode) {
    const sid = (senderSid || '').trim();
    const code = (verificationCode || '').trim();
    if (!sid) throw new Error('Sender SID is required');
    if (!code) throw new Error('Verification code is required');

    try {
      const sender = await this.client.messaging.v2
        .channelsSenders(sid)
        .update({
          configuration: {
            verification_code: code
          }
        });
      logger.info('Twilio sender verification code submitted', { sid, status: sender.status });
      return { sid: sender.sid, status: sender.status };
    } catch (err) {
      logger.error('Twilio submitVerificationCode failed', { senderSid: sid, error: err.message });
      throw err;
    }
  }

  /**
   * List WhatsApp channel senders for this Twilio account. Use to find a sender by phone number
   * after the user completes Meta Embedded Signup in Twilio Console.
   * @param {Object} [options] - { limit }
   * @returns {Promise<Array<{ sid: string, status: string, senderId: string }>>}
   */
  async listSenders(options = {}) {
    const { limit = 100 } = options;
    try {
      const senders = await this.client.messaging.v2.channelsSenders.list({ limit });
      return senders.map((s) => ({
        sid: s.sid,
        status: s.status,
        senderId: s.senderId
      }));
    } catch (err) {
      logger.error('Twilio listSenders failed', { error: err.message });
      throw err;
    }
  }

  /**
   * Find a WhatsApp sender SID by phone number (E.164). Use after user completes Meta signup in Twilio.
   * @param {string} phoneNumber - E.164 format
   * @returns {Promise<string | null>} sender SID or null if not found
   */
  async findSenderSidByPhoneNumber(phoneNumber) {
    const normalized = (phoneNumber || '').trim();
    if (!normalized) return null;
    const expectedSenderId = this._senderId(normalized);
    const senders = await this.listSenders();
    const match = senders.find((s) => (s.senderId || '').toLowerCase() === expectedSenderId.toLowerCase());
    return match ? match.sid : null;
  }

  /**
   * Fetch sender status from Twilio (e.g. CREATING, ONLINE, PENDING_VERIFICATION, FAILED).
   * @param {string} senderSid - Twilio sender SID
   * @returns {Promise<{ sid: string, status: string, sender_id?: string }>}
   */
  async getSender(senderSid) {
    const sid = (senderSid || '').trim();
    if (!sid) throw new Error('Sender SID is required');

    try {
      const sender = await this.client.messaging.v2.channelsSenders(sid).fetch();
      return {
        sid: sender.sid,
        status: sender.status,
        sender_id: sender.senderId
      };
    } catch (err) {
      logger.error('Twilio getSender failed', { senderSid: sid, error: err.message });
      throw err;
    }
  }
}

let instance = null;

function getWhatsAppSenderService() {
  if (!instance) {
    instance = new WhatsAppSenderService();
  }
  return instance;
}

module.exports = {
  WhatsAppSenderService,
  getWhatsAppSenderService
};
