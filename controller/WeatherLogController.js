import WeatherLog from "../model/WeatherLogSchema.js";
import axios from "axios";
import { successResponse } from '../utils/responseHandler.js';
import { AppError } from '../middleware/errorHandler.js';

const OPENWEATHER_API_KEY = process.env.WEATHER_API_KEY;

const getWeather = async (req, res, next) => {
    try {
        const { city } = req.query;

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
            next(new AppError(error.response.data.message || 'Weather API error', error.response.status));
        } else {
            next(error);
        }
    }
};

export default { getWeather };