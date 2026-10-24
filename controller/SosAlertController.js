import SosAlert from "../model/SosAlertSchema.js";
import { successResponse } from '../utils/responseHandler.js';
import { AppError } from '../middleware/errorHandler.js';
import { actorId, requireMatchingIdentity } from '../utils/actor.js';
import { jsonObject } from '../utils/validation.js';
import { pagination, pageResult } from '../utils/pagination.js';
import { sosReceipt, unconfirmedReceipt } from '../utils/sosReceipt.js';

const saveSosMessage = async (req, res, next) => {
    try {
        const { latitude, longitude } = jsonObject(req.body);
        const userId = requireMatchingIdentity(req, req.body.userId, req.body.username);
        const username = req.user.username;

        if (typeof latitude !== 'number' || !Number.isFinite(latitude) || latitude < -90 || latitude > 90 ||
            typeof longitude !== 'number' || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
            throw new AppError('Valid latitude and longitude are required', 400);
        }

        const filter = { userId, isHandled: false };
        let result;
        try {
            result = await SosAlert.findOneAndUpdate(filter, { $setOnInsert: {
                userId, username, latitude, longitude, timestamp: new Date(), isHandled: false,
            } }, { upsert: true, new: true, rawResult: true, runValidators: true,
                writeConcern: { w: 'majority', wtimeout: 5000 }, maxTimeMS: 5000 });
        } catch (error) {
            if (error.code !== 11000 || (error.keyPattern && !error.keyPattern.userId)) throw error;
            // Concurrent first inserts can race at the unique index. Return the winner,
            // without performing a second insert or overwriting its receipt/location.
            const existing = await SosAlert.findOne(filter).read('primary').readConcern('majority').maxTimeMS(5000);
            if (!existing) throw unconfirmedReceipt();
            successResponse(res, sosReceipt(existing, userId, true));
            return;
        }
        if (result?.ok !== 1 || result.lastErrorObject?.n !== 1 || !result.value ||
            typeof result.lastErrorObject?.updatedExisting !== 'boolean') throw unconfirmedReceipt();
        const alreadyActive = result.lastErrorObject.updatedExisting;
        successResponse(res, sosReceipt(result.value, userId, alreadyActive), alreadyActive ? 200 : 201);
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
        const { limit, filter } = pagination(req.query);
        const alerts = await SosAlert.find({ userId: actorId(req), isHandled: false, ...filter })
            .sort({ _id: -1 }).limit(limit + 1).lean();

        const page = pageResult(alerts, limit);
        successResponse(res, page.items, 200, { pagination: page.pagination });
    } catch (error) {
        next(error);
    }
};

const getCurrentReceipt = async (req, res, next) => {
    try {
        const userId = actorId(req);
        const alert = await SosAlert.findOne({ userId, isHandled: false }).read('primary').readConcern('majority').maxTimeMS(5000);
        successResponse(res, { receipt: alert ? sosReceipt(alert, userId, true) : null });
    } catch (error) { next(error); }
};

export default { saveSosMessage, updateSosStatus, getActiveSosAlerts, getCurrentReceipt };
