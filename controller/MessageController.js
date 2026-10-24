import Message from '../model/MessageSchema.js';
import User from '../model/UserSchema.js';
import { successResponse } from '../utils/responseHandler.js';
import { AppError } from '../middleware/errorHandler.js';
import { actorId, requireMatchingIdentity } from '../utils/actor.js';
import { objectId, text, jsonObject } from '../utils/validation.js';
import { pagination, pageResult } from '../utils/pagination.js';
import { messageDto, messageIds } from '../utils/messages.js';
import { publishMessageEvent } from '../realtime/messageEvents.js';

const writeConcern = { w: 'majority', wtimeout: 5000 };
const retryKey = value => {
  if (value === undefined) return undefined; // Existing clients remain compatible, without retry guarantees.
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new AppError('clientMessageId must be a UUID v4', 400);
  }
  return value.toLowerCase();
};
const findRetry = (senderId, clientMessageId) => Message.findOne({ senderId, clientMessageId })
  .read('primary').readConcern('majority').maxTimeMS(5000);
const assertSameSend = (saved, receiverId, message) => {
  if (saved.receiverId !== receiverId || saved.message !== message) {
    throw new AppError('This message retry key was already used for different content', 409);
  }
};
const receipt = row => ({ id: String(row._id), read: row.read === true,
  readAt: row.readAt ? row.readAt.toISOString() : null });

const MessageController = {
  sendMessage: async (req, res, next) => {
    try {
      const body = jsonObject(req.body);
      const receiverId = objectId(body.receiverId, 'receiver ID');
      const message = text(body.message, 'message', 4000);
      const senderId = requireMatchingIdentity(req, body.senderId);
      const clientMessageId = retryKey(body.clientMessageId);
      let saved = clientMessageId ? await findRetry(senderId, clientMessageId) : null;
      let created = false;
      if (!saved) {
        const receiver = await User.findById(receiverId).select('_id isActive');
        if (!receiver?.isActive) throw new AppError('Recipient is not available', 404);
        try {
          saved = new Message({ senderId, receiverId, message, clientMessageId, timestamp: new Date() });
          await saved.save({ writeConcern });
          created = true;
        } catch (error) {
          if (error.code !== 11000 || !clientMessageId) throw error;
          saved = await findRetry(senderId, clientMessageId);
          if (!saved) throw new AppError('Message result is uncertain; retry with the same key', 503);
        }
      }
      assertSameSend(saved, receiverId, message);
      const dto = messageDto(saved);
      publishMessageEvent([senderId, receiverId], { type: 'message.saved', message: dto });
      successResponse(res, dto, created ? 201 : 200);
    } catch (error) { next(error); }
  },

  getMessages: async (req, res, next) => {
    try {
      const user1 = objectId(req.query.user1, 'user1');
      const user2 = objectId(req.query.user2, 'user2');
      const { limit, filter } = pagination(req.query);
      if (user1 !== actorId(req) && user2 !== actorId(req)) {
        throw new AppError('Cannot read another conversation', 403);
      }
      const messages = await Message.find({ $and: [{ $or: [
        { senderId: user1, receiverId: user2 }, { senderId: user2, receiverId: user1 },
      ] }, filter] }).sort({ _id: -1 }).limit(limit + 1).lean();
      const page = pageResult(messages, limit);
      successResponse(res, page.items.map(messageDto), 200, { pagination: page.pagination });
    } catch (error) { next(error); }
  },

  markMessagesAsRead: async (req, res, next) => {
    try {
      const body = jsonObject(req.body);
      const receiverId = requireMatchingIdentity(req, body.userId);
      const ids = messageIds(body.messageIds);
      const result = await Message.updateMany({ _id: { $in: ids }, receiverId, read: { $ne: true } },
        { $set: { read: true, readAt: new Date() } }, { writeConcern });
      // Re-read actual persisted timestamps, including retries. Never acknowledge foreign IDs.
      const rows = await Message.find({ _id: { $in: ids }, receiverId, read: true }).limit(100).lean();
      const groups = new Map();
      for (const row of rows) {
        const group = groups.get(row.senderId) || [];
        group.push(receipt(row));
        groups.set(row.senderId, group);
      }
      for (const [senderId, receipts] of groups) {
        publishMessageEvent([senderId, receiverId], { type: 'messages.read', receipts });
      }
      successResponse(res, { message: 'Messages marked as read', modifiedCount: result.modifiedCount,
        receipts: rows.map(receipt) });
    } catch (error) { next(error); }
  },

  getReceipts: async (req, res, next) => {
    try {
      const ids = messageIds(jsonObject(req.body).messageIds);
      const userId = actorId(req);
      const rows = await Message.find({ _id: { $in: ids }, $or: [{ senderId: userId }, { receiverId: userId }] })
        .limit(100).lean();
      successResponse(res, rows.map(receipt));
    } catch (error) { next(error); }
  },

  getUnreadCounts: async (req, res, next) => {
    try {
      // Bounded to the visible directory page; no unbounded aggregation over all contacts.
      const senderIds = messageIds(jsonObject(req.body).senderIds);
      const rows = await Message.aggregate([
        { $match: { receiverId: actorId(req), read: { $ne: true }, senderId: { $in: senderIds } } },
        { $group: { _id: '$senderId', count: { $sum: 1 } } },
      ]).option({ maxTimeMS: 5000 });
      successResponse(res, rows.map(row => ({ senderId: row._id, count: row.count })));
    } catch (error) { next(error); }
  },
};
export default MessageController;
