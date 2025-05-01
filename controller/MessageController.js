import Message from '../model/MessageSchema.js';
import { successResponse } from '../utils/responseHandler.js';
import { AppError } from '../middleware/errorHandler.js';

const MessageController = {
  sendMessage: async (req, res, next) => {
    console.log('POST /messages/send - Request received!');
    console.log('Request Headers:', req.headers);
    console.log('Request Body:', req.body);
    try {
      const { senderId, receiverId, message } = req.body;

      if (!senderId || !receiverId || !message) {
        throw new AppError('Sender ID, receiver ID and message are required', 400);
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

      if (!messageIds || !Array.isArray(messageIds) || !userId) {
        throw new AppError('Valid message IDs array and user ID are required', 400);
      }

      const result = await Message.updateMany(
        {
          _id: { $in: messageIds },
          receiverId: userId,
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
