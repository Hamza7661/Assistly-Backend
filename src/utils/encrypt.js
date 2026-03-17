const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const KEY_LENGTH = 32;

/**
 * Get encryption key from env. Must be 32 bytes for aes-256.
 * If CALENDAR_TOKEN_ENCRYPTION_KEY is set, use it (padded/hashed to 32 bytes).
 * @returns {Buffer|null} 32-byte key or null if not configured
 */
function getEncryptionKey() {
  const raw = process.env.CALENDAR_TOKEN_ENCRYPTION_KEY;
  if (!raw || typeof raw !== 'string') return null;
  const hash = crypto.createHash('sha256').update(raw, 'utf8').digest();
  return hash.slice(0, KEY_LENGTH);
}

/**
 * Encrypt a string (e.g. refresh token). Returns null if encryption key not set.
 * @param {string} plaintext
 * @returns {string|null} base64(iv + authTag + ciphertext) or null
 */
function encrypt(plaintext) {
  const key = getEncryptionKey();
  if (!key) return null;
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, enc]).toString('base64');
}

/**
 * Decrypt a string produced by encrypt().
 * @param {string} encoded base64(iv + authTag + ciphertext)
 * @returns {string|null} plaintext or null if key not set or decrypt fails
 */
function decrypt(encoded) {
  const key = getEncryptionKey();
  if (!key) return null;
  try {
    const buf = Buffer.from(encoded, 'base64');
    if (buf.length < IV_LENGTH + AUTH_TAG_LENGTH) return null;
    const iv = buf.subarray(0, IV_LENGTH);
    const authTag = buf.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
    const ciphertext = buf.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
    decipher.setAuthTag(authTag);
    return decipher.update(ciphertext) + decipher.final('utf8');
  } catch (_) {
    return null;
  }
}

module.exports = { encrypt, decrypt, getEncryptionKey };
