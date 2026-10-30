import { createHmac } from 'node:crypto';
import AuthRateLimit from '../model/AuthRateLimitSchema.js';
import { config } from '../config/env.js';
import { AppError } from './errorHandler.js';

const policies = {
  '/register': ['mail', 10, 5],
  '/forgot-password': ['mail', 10, 5],
  '/resend-verification-otp': ['mail', 10, 5],
  '/login': ['login', 100, 20],
  '/verify-otp': ['code', 60, 10],
  '/verify-reset-otp': ['code', 60, 10],
  '/reset-password': ['reset', 30, 10],
};
const WINDOW_MS = 15 * 60 * 1000;

export const authRateLimit = async (req, res, next) => {
  const policy = policies[req.path.toLowerCase().replace(/\/+$/, '')];
  if (!policy) return next();
  const [group, ipLimit, accountLimit] = policy;
  const now = Date.now();
  const window = Math.floor(now / WINDOW_MS);
  const expiresAt = new Date((window + 1) * WINDOW_MS);
  const account = req.body.email || req.body.username;
  try {
    for (const [kind, identity, limit] of [['ip', req.ip, ipLimit], ['account', account.toLowerCase(), accountLimit]]) {
      const hash = createHmac('sha256', config.jwtSecret).update(`${group}:${kind}:${identity}`).digest('hex');
      const key = `${window}:${hash}`;
      const update = { $inc: { count: 1 }, $setOnInsert: { expiresAt } };
      let counter;
      try {
        counter = await AuthRateLimit.findOneAndUpdate({ _id: key }, update, { upsert: true, new: true });
      } catch (error) {
        // Another instance may have inserted the first counter concurrently.
        if (error.code !== 11000) throw error;
        counter = await AuthRateLimit.findOneAndUpdate({ _id: key }, { $inc: { count: 1 } }, { new: true });
      }
      if (!counter) throw new Error('Missing rate counter');
      if (counter.count > limit) {
        res.set('Retry-After', String(Math.ceil((expiresAt.getTime() - now) / 1000)));
        return next(new AppError('Too many authentication requests. Try again later.', 429));
      }
    }
    next();
  } catch {
    next(new AppError('Authentication temporarily unavailable', 503));
  }
};
