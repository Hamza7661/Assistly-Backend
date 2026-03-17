const crypto = require('crypto');

const SALT = 'assistly-twilio-sub-v1';

function deriveKey() {
  const secret =
    process.env.TWILIO_SUBACCOUNT_TOKEN_ENCRYPTION_KEY ||
    process.env.JWT_SECRET ||
    'dev-only-set-TWILIO_SUBACCOUNT_TOKEN_ENCRYPTION_KEY';
  return crypto.scryptSync(String(secret), SALT, 32);
}

function encryptAuthToken(plain) {
  if (!plain) return null;
  const key = deriveKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64');
}

function decryptAuthToken(b64) {
  if (!b64) return null;
  try {
    const key = deriveKey();
    const raw = Buffer.from(b64, 'base64');
    const iv = raw.subarray(0, 12);
    const tag = raw.subarray(12, 28);
    const data = raw.subarray(28);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return decipher.update(data, undefined, 'utf8') + decipher.final('utf8');
  } catch (e) {
    return null;
  }
}

module.exports = {
  encryptAuthToken,
  decryptAuthToken
};
