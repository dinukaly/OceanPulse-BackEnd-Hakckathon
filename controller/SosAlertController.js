import SosAlert from "../model/SosAlertSchema.js";
import { successResponse } from '../utils/responseHandler.js';
import { AppError } from '../middleware/errorHandler.js';
import { actorId, requireMatchingIdentity } from '../utils/actor.js';

const receipt = (alert, alreadyActive) => ({
    id: String(alert._id),
    receivedAt: alert.timestamp ?? null,
    status: 'recorded',
    responderNotified: false,
    alreadyActive
});

const saveSosMessage = async (req, res, next) => {
    try {
        const { latitude, longitude } = req.body;
        const userId = requireMatchingIdentity(req, req.body.userId, req.body.username);
        const username = req.user.username;

        if (typeof latitude !== 'number' || !Number.isFinite(latitude) || latitude < -90 || latitude > 90 ||
            typeof longitude !== 'number' || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
            throw new AppError('Valid latitude and longitude are required', 400);
        }

        const existingMessage = await SosAlert.findOne({ userId, isHandled: false });
        if (existingMessage) {
            successResponse(res, receipt(existingMessage, true));
            return;
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
        
        successResponse(res, receipt(savedMessage, false), 201);
    } catch (error) {
        next(error);
    }
};

const updateSosStatus = async (req, res, next) => {
    try {
        throw new AppError('SOS status updates require a responder workflow', 403);
    } catch (error) {
        next(error);
    }
};

const getActiveSosAlerts = async (req, res, next) => {
    try {
        const alerts = await SosAlert.find({ userId: actorId(req), isHandled: false })
            .sort({ timestamp: -1 });

        successResponse(res, alerts);
    } catch (error) {
        next(error);
    }
};

export default { saveSosMessage, updateSosStatus, getActiveSosAlerts };
