import WeatherLog from "../model/WeatherLogSchema.js";
import axios from "axios";
import { successResponse } from '../utils/responseHandler.js';
import { AppError } from '../middleware/errorHandler.js';
import { text } from '../utils/validation.js';

const OPENWEATHER_API_KEY = process.env.WEATHER_API_KEY;

const getWeather = async (req, res, next) => {
    try {
        const city = text(req.query.city, 'city', 100);

        if (!city) {
            throw new AppError('City is required', 400);
        }

        if (!process.env.WEATHER_API_KEY) {
            throw new AppError('Weather API key is not configured', 500);
        }

        const response = await axios.get('https://api.openweathermap.org/data/2.5/weather', {
            params: {
                q: city,
                appid: process.env.WEATHER_API_KEY,
                units: 'metric'
            }
        });

        successResponse(res, response.data);
    } catch (error) {
        if (error.response) {
            next(error.response.status === 404
                ? new AppError('Weather location not found', 404)
                : new AppError('Weather provider request failed', 502));
        } else {
            next(error);
        }
    }
};

export default { getWeather };
