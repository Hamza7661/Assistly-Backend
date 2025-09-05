const crypto = require('crypto');
const { AppError } = require('../utils/errorHandler');
const { logger } = require('../utils/logger');

// remove JWT option: HMAC-only from here down

// HMAC signed-request verification (per-request random nonce)
const getSigningSecret = () => {
  const secret = process.env.THIRD_PARTY_SIGNING_SECRET;
  if (!secret) throw new AppError('THIRD_PARTY_SIGNING_SECRET is not configured', 500);
  return secret;
};

// simple in-memory nonce store to reduce replay risk
const seenNonces = new Map(); // nonce -> expiresAt (ms)
const NONCE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_SKEW_MS = 5 * 60 * 1000; // 5 minutes

const pruneNonces = () => {
  const now = Date.now();
  for (const [nonce, exp] of seenNonces.entries()) {
    if (exp <= now) seenNonces.delete(nonce);
  }
};

const verifySignedThirdPartyForParamUser = (req, res, next) => {
  try {
    const ts = req.headers['x-tp-ts'] || req.query.ts;
    const nonce = req.headers['x-tp-nonce'] || req.query.nonce;
    const sig = req.headers['x-tp-sign'] || req.query.sign;
    if (!ts || !nonce || !sig) {
      return next(new AppError('Signed request headers missing', 401));
    }

    const tsMs = Number(ts);
    if (!Number.isFinite(tsMs)) return next(new AppError('Invalid timestamp', 401));
    const now = Date.now();
    if (Math.abs(now - tsMs) > MAX_SKEW_MS) return next(new AppError('Timestamp skew too large', 401));

    pruneNonces();
    if (seenNonces.has(nonce)) return next(new AppError('Replay detected', 401));

    const basePath = req.originalUrl.split('?')[0];
    const userId = req.params.id || req.params.userId;
    const toSign = `${req.method}\n${basePath}\nuserId=${userId}\n${tsMs}\n${nonce}`;
    const expected = crypto
      .createHmac('sha256', getSigningSecret())
      .update(toSign)
      .digest('hex');

    // normalize provided signature to lowercase hex
    const providedSig = String(sig).trim().toLowerCase();
    if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(providedSig))) {
      // Dev/debug aid: show canonical server view used for signing
      logger.error('Third-party HMAC mismatch', {
        method: req.method,
        path: basePath,
        userId,
        ts: tsMs,
        nonce,
        toSign,
        expected,
        provided: providedSig
      });
      return next(new AppError('Invalid signature', 401));
    }

    seenNonces.set(nonce, now + NONCE_TTL_MS);
    next();
  } catch (err) {
    next(new AppError('Invalid signed request', 401));
  }
};

module.exports.verifySignedThirdPartyForParamUser = verifySignedThirdPartyForParamUser;


