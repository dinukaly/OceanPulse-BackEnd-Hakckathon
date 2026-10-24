import { AppError } from '../middleware/errorHandler.js';
import { objectId } from './validation.js';

// Descending ObjectId order gives a stable, bounded insertion-order history.
export const pagination = (query) => {
  if (Object.keys(query).some(key => /[\[\]]/.test(key))) {
    throw new AppError('Query parameters must be scalar values', 400, 'VALIDATION_ERROR');
  }
  const raw = query.limit ?? '25';
  if (typeof raw !== 'string' || !/^[1-9]\d?$/.test(raw) || Number(raw) > 50) {
    throw new AppError('Limit must be an integer between 1 and 50', 400, 'VALIDATION_ERROR');
  }
  const before = query.before === undefined ? null : objectId(query.before, 'before cursor');
  return { limit: Number(raw), filter: before ? { _id: { $lt: before } } : {} };
};

export const pageResult = (rows, limit) => {
  const items = rows.slice(0, limit);
  const hasMore = rows.length > limit;
  return {
    items,
    pagination: { limit, hasMore, nextCursor: hasMore ? String(items.at(-1)._id) : null },
  };
};
