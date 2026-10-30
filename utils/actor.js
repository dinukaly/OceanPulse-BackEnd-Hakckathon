import { AppError } from '../middleware/errorHandler.js';
import { objectId, text } from './validation.js';

export const actorId = (req) => String(req.user.userId);

export const requireMatchingIdentity = (req, userId, username) => {
  const id = actorId(req);
  if (userId != null && objectId(userId, 'user ID') !== id) {
    throw new AppError('Cannot act as another user', 403);
  }
  if (username != null && text(username, 'username', 100) !== req.user.username) {
    throw new AppError('Cannot act as another user', 403);
  }
  return id;
};
