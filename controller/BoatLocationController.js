import BoatLocation from "../model/BoatLocationSchema.js";
import { successResponse } from '../utils/responseHandler.js';
import { AppError } from '../middleware/errorHandler.js';

const updateLocation = async (req, res, next) => {
    try {
        const { userId, latitude, longitude } = req.body;

        if (!userId || !latitude || !longitude) {
            throw new AppError('User ID, latitude, and longitude are required', 400);
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
        const { latitude, longitude, maxDistance = 10000 } = req.query; // maxDistance in meters, default 10km

        if (!latitude || !longitude) {
            throw new AppError('Latitude and longitude are required', 400);
        }

        const nearbyBoats = await BoatLocation.find({
            location: {
                $near: {
                    $geometry: {
                        type: 'Point',
                        coordinates: [parseFloat(longitude), parseFloat(latitude)]
                    },
                    $maxDistance: parseInt(maxDistance)
                }
            }
        });

        successResponse(res, nearbyBoats);
    } catch (error) {
        next(error);
    }
};

export default { updateLocation, getBoatLocation, getNearbyBoats };
