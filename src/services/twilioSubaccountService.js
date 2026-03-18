const twilio = require('twilio');
const { logger } = require('../utils/logger');

/**
 * Create a Twilio subaccount under the parent account (for per-app WhatsApp isolation).
 * @param {string} friendlyName - e.g. App subaccount name or id
 * @returns {Promise<{ sid: string, authToken: string }>}
 */
async function createTwilioSubaccount(friendlyName) {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!accountSid || !authToken) {
    throw new Error('TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN are required to create subaccounts');
  }
  const client = twilio(accountSid, authToken);
  const name = (friendlyName || 'App subaccount').slice(0, 64);
  const account = await client.api.accounts.create({ friendlyName: name });
  logger.info('Twilio subaccount created', { sid: account.sid, friendlyName: name });
  return {
    sid: account.sid,
    authToken: account.authToken
  };
}

module.exports = {
  createTwilioSubaccount
};
