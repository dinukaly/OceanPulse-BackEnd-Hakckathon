import SosAlert from "../model/SosAlertSchema.js";
import { successResponse } from '../utils/responseHandler.js';
import { AppError } from '../middleware/errorHandler.js';

const saveSosMessage = async (req, res, next) => {
    try {
        const { latitude, longitude, userId, username } = req.body;

        if (!latitude || !longitude || !userId || !username) {
            throw new AppError('Latitude, longitude, userId, and username are required', 400);
        }

        const existingMessage = await SosAlert.findOne({ username, isHandled: false });
        if (existingMessage) {
            throw new AppError('Active SOS alert already exists for this user', 400);
        }

        const newMessage = new SosAlert({
            latitude,
            longitude,
            userId,
            username,
            timestamp: new Date(),
            isHandled: false
        });

        const savedMessage = await newMessage.save();
        
        successResponse(res, savedMessage, 201);
    } catch (error) {
        next(error);
    }
};

const updateSosStatus = async (req, res, next) => {
    try {
        const { messageId } = req.params;
        const { isHandled } = req.body;

        if (typeof isHandled !== 'boolean') {
            throw new AppError('isHandled status must be a boolean', 400);
        }

        const message = await SosAlert.findById(messageId);
        if (!message) {
            throw new AppError('SOS message not found', 404);
        }

        message.isHandled = isHandled;
        await message.save();

        successResponse(res, message);
    } catch (error) {
        next(error);
    }
};

const getActiveSosAlerts = async (req, res, next) => {
    try {
        const alerts = await SosAlert.find({ isHandled: false })
            .sort({ timestamp: -1 });

        successResponse(res, alerts);
    } catch (error) {
        next(error);
    }
};

export default { saveSosMessage, updateSosStatus, getActiveSosAlerts };