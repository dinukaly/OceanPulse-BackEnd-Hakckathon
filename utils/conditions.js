import { AppError } from '../middleware/errorHandler.js';
import { text } from './validation.js';

export const PROVIDER_TIMEOUT_MS = 10_000;
export const invalidProvider = () => new AppError('Provider returned invalid condition data', 502, 'UPSTREAM_ERROR');
const finite = value => typeof value === 'number' && Number.isFinite(value);

export const coordinates = query => {
  const result = {};
  for (const [field, max] of [['latitude', 90], ['longitude', 180]]) {
    const value = text(query[field], field, 30);
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value) || Math.abs(Number(value)) > max) {
      throw new AppError(`Invalid ${field}`, 400, 'VALIDATION_ERROR');
    }
    result[field] = Number(value);
  }
  return result;
};

const providerCoordinates = (latitude, longitude) => {
  if (!finite(latitude) || !finite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) throw invalidProvider();
  return { latitude, longitude };
};
const optionalNumber = (value, min = -Infinity, max = Infinity) => {
  if (value === undefined || value === null) return null;
  if (!finite(value) || value < min || value > max) throw invalidProvider();
  return value;
};
const optionalText = value => typeof value === 'string' && value.trim() ? value.trim() : null;
const timestamp = value => {
  if (!Number.isSafeInteger(value) || value < 0 || value > 8_640_000_000_000) throw invalidProvider();
  return new Date(value * 1000).toISOString();
};

export const normalizeWeather = (raw, requestedLocation, now = Date.now()) => {
  if (!raw || Array.isArray(raw) || (raw.cod !== undefined && Number(raw.cod) !== 200)) throw invalidProvider();
  const location = providerCoordinates(raw.coord?.lat, raw.coord?.lon);
  const dataTime = raw.dt == null ? null : timestamp(raw.dt);
  const offset = optionalNumber(raw.timezone, -86400, 86400);
  if (offset !== null && !Number.isInteger(offset)) throw invalidProvider();
  const temperatureC = optionalNumber(raw.main?.temp);
  const humidityPercent = optionalNumber(raw.main?.humidity, 0, 100);
  const cloudCoverPercent = optionalNumber(raw.clouds?.all, 0, 100);
  const windSpeedMps = optionalNumber(raw.wind?.speed, 0);
  const description = optionalText(raw.weather?.[0]?.description);
  const icon = typeof raw.weather?.[0]?.icon === 'string' && /^\d{2}[dn]$/.test(raw.weather[0].icon) ? raw.weather[0].icon : null;
  return {
    kind: 'current-weather', requestedLocation,
    location: { ...location, name: optionalText(raw.name), country: optionalText(raw.sys?.country), utcOffsetSeconds: offset },
    source: { name: 'OpenWeather', url: 'https://openweathermap.org/', attribution: 'Weather data: OpenWeather' },
    units: { temperature: '°C', windSpeed: 'm/s', humidity: '%', cloudCover: '%' },
    dataTime, fetchedAt: new Date(now).toISOString(),
    // An application freshness warning, not a provider accuracy/safety guarantee.
    staleAfter: dataTime ? new Date(Date.parse(dataTime) + 3_600_000).toISOString() : null,
    available: [temperatureC, humidityPercent, cloudCoverPercent, windSpeedMps, description].some(value => value !== null),
    temperatureC, humidityPercent, cloudCoverPercent, windSpeedMps, description, icon,
  };
};

export const normalizeMarine = (raw, requestedLocation, now = Date.now()) => {
  if (!raw || Array.isArray(raw) || raw.error || raw.utc_offset_seconds !== 0 ||
      raw.hourly_units?.time !== 'unixtime' || raw.hourly_units?.wave_height !== 'm') throw invalidProvider();
  const location = providerCoordinates(raw.latitude, raw.longitude);
  const times = raw.hourly?.time;
  const heights = raw.hourly?.wave_height;
  if (!Array.isArray(times) || !Array.isArray(heights) || times.length !== heights.length || times.length > 192) throw invalidProvider();
  const hourly = times.map((time, index) => {
    if (index && time - times[index - 1] !== 3600) throw invalidProvider();
    return { time: timestamp(time), waveHeightM: optionalNumber(heights[index], 0) };
  });
  return {
    kind: 'marine-forecast', requestedLocation, location,
    source: { name: 'Open-Meteo', url: 'https://open-meteo.com/',
      attribution: 'Marine data: Open-Meteo and DWD', dataSourcesUrl: 'https://open-meteo.com/en/docs/marine-weather-api#data-sources' },
    units: { waveHeight: 'm', time: 'UTC' }, fetchedAt: new Date(now).toISOString(),
    modelIssuedAt: null, // generationtime_ms measures request processing, not the model's issue time.
    refreshAfter: new Date(now + 3_600_000).toISOString(),
    available: hourly.some(entry => entry.waveHeightM !== null),
    validFrom: hourly[0]?.time ?? null,
    validTo: hourly.length ? new Date(Date.parse(hourly[hourly.length - 1].time) + 3_600_000).toISOString() : null,
    hourly,
  };
};

export const providerFailure = (error, name, cityLookup = false) => {
  if (error instanceof AppError) return error;
  if (cityLookup && error.response?.status === 404) return new AppError('Weather location not found', 404);
  if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') return new AppError(`${name} request timed out`, 504, 'UPSTREAM_TIMEOUT');
  if (error.response?.status === 429) return new AppError(`${name} is temporarily rate limited`, 503, 'PROVIDER_RATE_LIMITED');
  return new AppError(`${name} is unavailable. Please try again.`, 502, 'UPSTREAM_ERROR');
};
