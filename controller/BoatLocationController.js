import BoatLocation from "../model/BoatLocationSchema.js";
import { successResponse } from '../utils/responseHandler.js';
import { AppError } from '../middleware/errorHandler.js';
import { actorId, requireMatchingIdentity } from '../utils/actor.js';

const updateLocation = async (req, res, next) => {
    try {
        const { latitude, longitude } = req.body;
        const userId = requireMatchingIdentity(req, req.body.userId);

        if (typeof latitude !== 'number' || !Number.isFinite(latitude) || latitude < -90 || latitude > 90 ||
            typeof longitude !== 'number' || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
            throw new AppError('Valid latitude and longitude are required', 400);
        }

        const location = await BoatLocation.findOneAndUpdate(
            { userId },
            {
                userId,
                location: {
                    type: 'Point',
                    coordinates: [longitude, latitude]
                },
                lastUpdated: new Date()
            },
            { upsert: true, new: true }
        );

        successResponse(res, location);
    } catch (error) {
        next(error);
    }
};

const getBoatLocation = async (req, res, next) => {
    try {
        const { userId } = req.params;

        if (!userId) {
            throw new AppError('User ID is required', 400);
        }
        if (userId !== actorId(req)) {
            throw new AppError('Cannot read another user location', 403);
        }

        const location = await BoatLocation.findOne({ userId });
        if (!location) {
            throw new AppError('Location not found for this user', 404);
        }

        successResponse(res, location);
    } catch (error) {
        next(error);
    }
};

const getNearbyBoats = async (req, res, next) => {
    try {
        throw new AppError('Nearby boat sharing is unavailable until a location-sharing policy is defined', 403);
    } catch (error) {
        next(error);
    }
};

export default { updateLocation, getBoatLocation, getNearbyBoats };
