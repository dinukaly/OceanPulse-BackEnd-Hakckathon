import axios from 'axios';
import { successResponse } from '../utils/responseHandler.js';
import { coordinates, normalizeMarine, providerFailure, PROVIDER_TIMEOUT_MS } from '../utils/conditions.js';

const fetchWaveCondition = async (req, res, next) => {
  try {
    const requested = coordinates(req.query);
    const response = await axios.get('https://marine-api.open-meteo.com/v1/marine', {
      params: { ...requested, hourly: 'wave_height', timezone: 'UTC', timeformat: 'unixtime',
        length_unit: 'metric', cell_selection: 'sea', forecast_days: 7 },
      timeout: PROVIDER_TIMEOUT_MS,
    });
    res.set('Cache-Control', 'no-store');
    successResponse(res, normalizeMarine(response.data, requested));
  } catch (error) { next(providerFailure(error, 'Marine provider')); }
};

export default { fetchWaveCondition };
