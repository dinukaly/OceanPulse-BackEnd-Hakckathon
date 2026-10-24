import Message from '../model/MessageSchema.js';
import { successResponse } from '../utils/responseHandler.js';
import { AppError } from '../middleware/errorHandler.js';
import { actorId, requireMatchingIdentity } from '../utils/actor.js';
import { objectId, text, jsonObject } from '../utils/validation.js';
import { pagination, pageResult } from '../utils/pagination.js';

const MessageController = {
  sendMessage: async (req, res, next) => {
    try {
      const body = jsonObject(req.body);
      const receiverId = objectId(body.receiverId, 'receiver ID');
      const message = text(body.message, 'message', 4000);
      const senderId = requireMatchingIdentity(req, req.body.senderId);

      if (typeof receiverId !== 'string' || !receiverId.trim() || typeof message !== 'string' || !message.trim()) {
        throw new AppError('Receiver ID and message are required', 400);
      }

      const newMessage = new Message({
        senderId,
        receiverId,
        message,
        timestamp: new Date(),
      });

      await newMessage.save();

      successResponse(res, {
        id: newMessage._id.toString(),
        senderId: newMessage.senderId,
        receiverId: newMessage.receiverId,
        message: newMessage.message,
        timestamp: newMessage.timestamp.toISOString(),
      }, 201);
    } catch (error) {
      next(error);
    }
  },

  getMessages: async (req, res, next) => {
    try {
      const user1 = objectId(req.query.user1, 'user1');
      const user2 = objectId(req.query.user2, 'user2');
      const { limit, filter } = pagination(req.query);

      if (!user1 || !user2) {
        throw new AppError('Both user IDs are required', 400);
      }
      if (user1 !== actorId(req) && user2 !== actorId(req)) {
        throw new AppError('Cannot read another conversation', 403);
      }

      const messages = await Message.find({ $and: [{
        $or: [
          { senderId: user1, receiverId: user2 },
          { senderId: user2, receiverId: user1 },
        ],
      }, filter] })
        .sort({ _id: -1 })
        .limit(limit + 1)
        .lean();

      const page = pageResult(messages, limit);
      const formattedMessages = page.items.map((msg) => ({
        id: msg._id.toString(),
        senderId: msg.senderId,
        receiverId: msg.receiverId,
        message: msg.message,
        timestamp: msg.timestamp ? msg.timestamp.toISOString() : null,
        read: msg.read,
        readAt: msg.readAt ? msg.readAt.toISOString() : null,
      }));

      successResponse(res, formattedMessages, 200, { pagination: page.pagination });
    } catch (error) {
      next(error);
    }
  },

  markMessagesAsRead: async (req, res, next) => {
    try {
      const { messageIds, userId } = jsonObject(req.body);
      const receiverId = requireMatchingIdentity(req, userId);

      if (!Array.isArray(messageIds) || messageIds.length === 0 || messageIds.length > 100) {
        throw new AppError('Between 1 and 100 message IDs are required', 400);
      }
      const ids = [...new Set(messageIds.map((id) => objectId(id, 'message ID')))];

      const result = await Message.updateMany(
        {
          _id: { $in: ids },
          receiverId,
          read: { $ne: true },
        },
        { $set: { read: true, readAt: new Date() } }
      );

      successResponse(res, {
        message: 'Messages marked as read',
        modifiedCount: result.modifiedCount
      });
    } catch (error) {
      next(error);
    }
  },
};


export default MessageController;
