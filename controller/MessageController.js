import Message from '../model/MessageSchema.js';
import { successResponse } from '../utils/responseHandler.js';
import { AppError } from '../middleware/errorHandler.js';
import { actorId, requireMatchingIdentity } from '../utils/actor.js';

const MessageController = {
  sendMessage: async (req, res, next) => {
    try {
      const { receiverId, message } = req.body;
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
      const { user1, user2 } = req.query;

      if (!user1 || !user2) {
        throw new AppError('Both user IDs are required', 400);
      }
      if (user1 !== actorId(req) && user2 !== actorId(req)) {
        throw new AppError('Cannot read another conversation', 403);
      }

      const messages = await Message.find({
        $or: [
          { senderId: user1, receiverId: user2 },
          { senderId: user2, receiverId: user1 },
        ],
      })
        .sort({ timestamp: 1 })
        .lean();

      const formattedMessages = messages.map((msg) => ({
        id: msg._id.toString(),
        senderId: msg.senderId,
        receiverId: msg.receiverId,
        message: msg.message,
        timestamp: msg.timestamp.toISOString(),
        read: msg.read,
        readAt: msg.readAt ? msg.readAt.toISOString() : null,
      }));

      successResponse(res, formattedMessages);
    } catch (error) {
      next(error);
    }
  },

  markMessagesAsRead: async (req, res, next) => {
    try {
      const { messageIds, userId } = req.body;
      const receiverId = requireMatchingIdentity(req, userId);

      if (!Array.isArray(messageIds) || messageIds.length === 0) {
        throw new AppError('A non-empty message IDs array is required', 400);
      }

      const result = await Message.updateMany(
        {
          _id: { $in: messageIds },
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
