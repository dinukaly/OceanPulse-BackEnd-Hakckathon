import { AppError } from '../middleware/errorHandler.js';

export const objectId = (value, field = 'ID') => {
  if (typeof value !== 'string' || !/^[a-f\d]{24}$/i.test(value)) {
    throw new AppError(`Invalid ${field}`, 400, 'VALIDATION_ERROR');
  }
  return value.toLowerCase();
};

export const text = (value, field, max, allowEmpty = false) => {
  if (typeof value !== 'string' || value.length > max || (!allowEmpty && !value.trim())) {
    throw new AppError(`Invalid ${field}`, 400, 'VALIDATION_ERROR');
  }
  return value.trim();
};

export const jsonObject = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AppError('A JSON object is required', 400, 'VALIDATION_ERROR');
  }
  return value;
};
