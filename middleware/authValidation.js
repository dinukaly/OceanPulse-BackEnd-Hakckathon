import { AppError } from './errorHandler.js';

const fields = {
  '/register': ['firstName', 'lastName', 'email', 'contact', 'password'],
  '/login': ['email', 'password'],
  '/verify-otp': ['username', 'otp'],
  '/resend-verification-otp': ['username', 'email'],
  '/forgot-password': ['email'],
  '/verify-reset-otp': ['email', 'otp'],
  '/reset-password': ['email', 'password', 'resetToken'],
};

export const validateAuthRequest = (req, res, next) => {
  const route = req.path.toLowerCase().replace(/\/+$/, '');
  const required = fields[route];
  if (!required) return next();
  try {
    if (!req.body || Array.isArray(req.body) || typeof req.body !== 'object') {
      throw new AppError('A JSON object is required', 400);
    }
    for (const field of [...required, ...(route === '/register' && req.body.boatId !== undefined ? ['boatId'] : [])]) {
      const value = req.body[field];
      const max = field === 'resetToken' ? 2048 : field === 'email' ? 254 : field === 'password' ? 72 : 100;
      if (typeof value !== 'string' || (field !== 'boatId' && !value.trim()) || value.length > max ||
          (field === 'password' && Buffer.byteLength(value, 'utf8') > 72)) {
        throw new AppError(`Invalid ${field}`, 400);
      }
      if (field !== 'password') req.body[field] = value.trim();
    }
    if (required.includes('email') && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(req.body.email)) {
      throw new AppError('Invalid email', 400);
    }
    if (required.includes('otp') && !/^\d{6}$/.test(req.body.otp)) {
      throw new AppError('Verification code must contain six digits', 400);
    }
    next();
  } catch (error) { next(error); }
};
