// controller/WaveConditionController.js
import axios from 'axios';
import { successResponse } from '../utils/responseHandler.js';
import { AppError } from '../middleware/errorHandler.js';

const fetchWaveCondition = async (req, res, next) => {
  try {
    const { latitude, longitude } = req.query;

    if (!latitude || !longitude) {
      throw new AppError('Latitude and longitude are required', 400);
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
      next(new AppError(error.response.data.message || 'External API error', error.response.status));
    } else {
      next(error);
    }
  }
};

export default { fetchWaveCondition };
