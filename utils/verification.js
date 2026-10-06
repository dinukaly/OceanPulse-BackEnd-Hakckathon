import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { config } from '../config/env.js';
import { AppError } from '../middleware/errorHandler.js';

const CODE_TTL_MS = 10 * 60 * 1000;
const RESEND_WAIT_MS = 60 * 1000;
const MAX_ATTEMPTS = 5;

const codeHash = (user, purpose, code) => createHmac('sha256', config.jwtSecret)
  .update(`${user._id}:${purpose}:${code}`)
  .digest('hex');

export const clearVerification = (user) => {
  user.verificationCodeHash = undefined;
  user.verificationPurpose = undefined;
  user.verificationExpiresAt = undefined;
  user.verificationAttempts = 0;
  user.verificationSentAt = undefined;
  user.otp = undefined; // Clear any legacy plain-text code.
};

export const issueVerification = (user, purpose) => {
  const now = Date.now();
  if (user.verificationSentAt && now - user.verificationSentAt.getTime() < RESEND_WAIT_MS) {
    throw new AppError('Please wait before requesting another code', 429);
  }
  if (user.verificationExpiresAt && user.verificationExpiresAt.getTime() > now &&
      user.verificationAttempts >= MAX_ATTEMPTS) {
    throw new AppError('Too many attempts. Try again after the code expires', 429);
  }
  const code = String(randomInt(100000, 1000000));
  user.verificationCodeHash = codeHash(user, purpose, code);
  user.verificationPurpose = purpose;
  user.verificationAttempts = user.verificationExpiresAt && user.verificationExpiresAt.getTime() > now
    ? (user.verificationAttempts || 0) : 0;
  user.verificationExpiresAt = new Date(now + CODE_TTL_MS);
  user.verificationSentAt = new Date(now);
  user.otp = undefined;
  return code;
};

export const verifyCode = async (user, purpose, code) => {
  if (!/^\d{6}$/.test(String(code || '')) || user.verificationPurpose !== purpose ||
      !user.verificationCodeHash || !user.verificationExpiresAt ||
      user.verificationExpiresAt.getTime() <= Date.now() ||
      user.verificationAttempts >= MAX_ATTEMPTS) {
    throw new AppError('Invalid or expired verification code', 400);
  }
  const expected = Buffer.from(user.verificationCodeHash, 'hex');
  const actual = Buffer.from(codeHash(user, purpose, String(code)), 'hex');
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    user.verificationAttempts = (user.verificationAttempts || 0) + 1;
    await user.save();
    throw new AppError('Invalid or expired verification code', 400);
  }
  clearVerification(user);
};
