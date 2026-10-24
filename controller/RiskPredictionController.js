// controller/WaveConditionController.js
import axios from 'axios';
import { successResponse } from '../utils/responseHandler.js';
import { AppError } from '../middleware/errorHandler.js';
import { text } from '../utils/validation.js';

const fetchWaveCondition = async (req, res, next) => {
  try {
    const latitude = Number(text(req.query.latitude, 'latitude', 30));
    const longitude = Number(text(req.query.longitude, 'longitude', 30));

    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 ||
        !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
      throw new AppError('Valid latitude and longitude are required', 400);
    }

    const apiUrl = `https://marine-api.open-meteo.com/v1/marine?latitude=${latitude}&longitude=${longitude}&hourly=wave_height&timezone=auto`;

    const response = await axios.get(apiUrl);
    
    const transformedData = {
      hourly: response.data.hourly.time.map((time, index) => ({
        time,
        wave_height: response.data.hourly.wave_height[index]
      }))
    };

    successResponse(res, transformedData);
  } catch (error) {
    if (error.response) {
      next(new AppError('Marine provider request failed', 502));
    } else {
      next(error);
    }
  }
};

export default { fetchWaveCondition };
