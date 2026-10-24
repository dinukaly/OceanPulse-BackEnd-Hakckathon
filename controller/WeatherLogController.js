import axios from 'axios';
import { successResponse } from '../utils/responseHandler.js';
import { AppError } from '../middleware/errorHandler.js';
import { text } from '../utils/validation.js';
import { coordinates, normalizeWeather, providerFailure, PROVIDER_TIMEOUT_MS } from '../utils/conditions.js';

const getWeather = async (req, res, next) => {
  try {
    const byCoordinates = req.query.latitude !== undefined || req.query.longitude !== undefined;
    if (byCoordinates && req.query.city !== undefined) throw new AppError('Supply a city or coordinates, not both', 400);
    const requested = byCoordinates ? coordinates(req.query) : { city: text(req.query.city, 'city', 100) };
    if (!process.env.WEATHER_API_KEY) throw new AppError('Weather provider is not configured', 503);
    const response = await axios.get('https://api.openweathermap.org/data/2.5/weather', {
      params: { ...(byCoordinates ? { lat: requested.latitude, lon: requested.longitude } : { q: requested.city }),
        appid: process.env.WEATHER_API_KEY, units: 'metric' },
      timeout: PROVIDER_TIMEOUT_MS,
    });
    res.set('Cache-Control', 'no-store');
    successResponse(res, normalizeWeather(response.data, requested));
  } catch (error) { next(providerFailure(error, 'Weather provider', true)); }
};

export default { getWeather };
