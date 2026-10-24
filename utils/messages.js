import { AppError } from '../middleware/errorHandler.js';
import { objectId } from './validation.js';

export const messageDto = msg => ({
  id: String(msg._id), senderId: msg.senderId, receiverId: msg.receiverId,
  clientMessageId: msg.clientMessageId ?? null, message: msg.message,
  timestamp: msg.timestamp ? msg.timestamp.toISOString() : null,
  read: msg.read === true, readAt: msg.readAt ? msg.readAt.toISOString() : null,
});

export const messageIds = value => {
  if (!Array.isArray(value) || !value.length || value.length > 100) {
    throw new AppError('Between 1 and 100 message IDs are required', 400);
  }
  return [...new Set(value.map(id => objectId(id, 'message ID')))];
};
