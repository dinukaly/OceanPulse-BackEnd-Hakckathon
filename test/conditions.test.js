import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import jwt from 'jsonwebtoken';

process.env.JWT_SECRET_KEY = 'test-only-signing-key';
process.env.WEATHER_API_KEY = 'test-only-weather-key';
const [{ default: User }, { default: axios }, { default: weatherRoutes }, { default: marineRoutes },
  { errorHandler }, { normalizeWeather, normalizeMarine }] = await Promise.all([
  import('../model/UserSchema.js'), import('axios'), import('../routes/WeatherLogRoute.js'),
  import('../routes/RiskPredictionRoute.js'), import('../middleware/errorHandler.js'), import('../utils/conditions.js'),
]);
const now = Date.parse('2026-10-24T12:30:00Z');
const firstHour = Date.parse('2026-10-24T00:00:00Z') / 1000;
const weather = () => ({ coord: { lat: 8.2, lon: 79.7 }, name: 'Kalpitiya', sys: { country: 'LK' }, timezone: 19800,
  dt: (now - 900_000) / 1000, main: { temp: 28.5, humidity: 80 }, wind: { speed: 10 }, clouds: { all: 30 },
  weather: [{ description: 'clouds', icon: '03d' }], cod: 200 });
const marine = () => ({ latitude: 8.25, longitude: 79.75, utc_offset_seconds: 0, timezone: 'GMT', generationtime_ms: 1.2,
  hourly_units: { time: 'unixtime', wave_height: 'm' },
  hourly: { time: Array.from({ length: 24 }, (_, i) => firstHour + i * 3600), wave_height: Array(24).fill(1.2) } });
const actor = '507f1f77bcf86cd799439011';
const originalUser = User.findById;
const originalGet = axios.get;
User.findById = () => ({ select: async () => ({ _id: actor, username: 'test', isActive: true, authVersion: 0 }) });
let provider;
axios.get = (...args) => provider(...args);
const app = express();
app.use('/weather', weatherRoutes);
app.use('/marine', marineRoutes);
app.use(errorHandler);
const server = app.listen(0);
const token = jwt.sign({ userId: actor, purpose: 'access', authVersion: 0 }, process.env.JWT_SECRET_KEY);
const request = async path => {
  const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  return { status: response.status, body: await response.json(), headers: response.headers };
};
after(async () => {
  User.findById = originalUser;
  axios.get = originalGet;
  await new Promise(resolve => server.close(resolve));
});

test('weather city request keeps metric m/s, source calculation time and resolved coordinates', async () => {
  provider = async (url, options) => {
    assert.equal(url, 'https://api.openweathermap.org/data/2.5/weather');
    assert.equal(options.params.q, 'Kalpitiya,LK');
    assert.equal(options.params.units, 'metric');
    assert.equal(options.timeout, 10_000);
    return { data: weather() };
  };
  const response = await request('/weather/weather?city=%20Kalpitiya,LK%20');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const data = response.body.data;
  assert.equal(data.units.windSpeed, 'm/s');
  assert.equal(data.windSpeedMps, 10);
  assert.equal(data.dataTime, '2026-10-24T12:15:00.000Z');
  assert.equal(data.location.utcOffsetSeconds, 19800);
  assert.deepEqual(data.requestedLocation, { city: 'Kalpitiya,LK' });
  assert.equal(data.location.latitude, 8.2);
  assert.equal(data.source.name, 'OpenWeather');
});

test('weather supports exact coordinate requests including zero without a default city', async () => {
  provider = async (url, options) => {
    assert.equal(options.params.lat, 0);
    assert.equal(options.params.lon, 0);
    assert.equal(options.params.q, undefined);
    return { data: { ...weather(), coord: { lat: 0, lon: 0 } } };
  };
  const response = await request('/weather/weather?latitude=0&longitude=0');
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.data.requestedLocation, { latitude: 0, longitude: 0 });
});

test('missing measurements and unknown source time remain null; zero values stay zero', () => {
  const raw = weather();
  raw.main = { temp: 0 };
  raw.clouds = undefined;
  raw.wind = { speed: 0 };
  raw.dt = undefined;
  raw.weather = [];
  const result = normalizeWeather(raw, { city: 'test' }, now);
  assert.equal(result.temperatureC, 0);
  assert.equal(result.windSpeedMps, 0);
  assert.equal(result.humidityPercent, null);
  assert.equal(result.cloudCoverPercent, null);
  assert.equal(result.description, null);
  assert.equal(result.icon, null);
  assert.equal(result.dataTime, null);
  assert.equal(result.staleAfter, null);
  assert.equal(result.fetchedAt, '2026-10-24T12:30:00.000Z');
  const old = normalizeWeather({ ...weather(), dt: (now - 7_200_000) / 1000 }, { city: 'test' }, now);
  assert.ok(Date.parse(old.staleAfter) < Date.parse(old.fetchedAt));
});

test('marine forwards supplied coordinates and normalizes hourly UTC while preserving missing heights', async () => {
  provider = async (url, options) => {
    assert.equal(url, 'https://marine-api.open-meteo.com/v1/marine');
    assert.equal(options.params.latitude, 8.2);
    assert.equal(options.params.longitude, 79.7);
    assert.equal(options.params.timeformat, 'unixtime');
    assert.equal(options.params.timezone, 'UTC');
    assert.equal(options.params.length_unit, 'metric');
    assert.equal(options.params.cell_selection, 'sea');
    assert.equal(options.params.forecast_days, 7);
    assert.equal(options.timeout, 10_000);
    const raw = marine();
    raw.hourly.wave_height[0] = null;
    raw.hourly.wave_height[1] = 0;
    return { data: raw };
  };
  const response = await request('/marine/risk-prediction?latitude=8.2&longitude=79.7');
  assert.equal(response.status, 200);
  const data = response.body.data;
  assert.equal(data.hourly[0].time, '2026-10-24T00:00:00.000Z');
  assert.equal(data.hourly[0].waveHeightM, null);
  assert.equal(data.hourly[1].waveHeightM, 0);
  assert.deepEqual(data.requestedLocation, { latitude: 8.2, longitude: 79.7 });
  assert.deepEqual(data.location, { latitude: 8.25, longitude: 79.75 });
  assert.equal(data.modelIssuedAt, null);
  assert.equal(data.units.waveHeight, 'm');
  assert.equal(data.validTo, '2026-10-25T00:00:00.000Z');
  assert.equal(data.source.name, 'Open-Meteo');
});

test('empty and all-null marine data cannot become calm or zero-wave forecasts', () => {
  const empty = marine();
  empty.hourly = { time: [], wave_height: [] };
  const result = normalizeMarine(empty, { latitude: 0, longitude: 0 }, now);
  assert.equal(result.available, false);
  assert.equal(result.validFrom, null);
  assert.equal(result.validTo, null);
  const missing = marine();
  missing.hourly.wave_height.fill(null);
  assert.equal(normalizeMarine(missing, { latitude: 0, longitude: 0 }, now).available, false);
});

test('malformed provider units, coordinates, numeric types and timestamp arrays are rejected', () => {
  const malformed = [raw => { raw.hourly_units.wave_height = 'ft'; }, raw => { raw.hourly_units.time = 'iso8601'; },
    raw => { raw.latitude = null; }, raw => { raw.hourly.wave_height.pop(); },
    raw => { raw.hourly.time[1] = raw.hourly.time[0]; }, raw => { raw.hourly.wave_height[0] = -1; },
    raw => { raw.hourly.wave_height[0] = '0'; }, raw => { raw.utc_offset_seconds = 19800; }];
  for (const mutate of malformed) {
    const raw = marine(); mutate(raw);
    assert.throws(() => normalizeMarine(raw, { latitude: 0, longitude: 0 }, now), { statusCode: 502 });
  }
  for (const raw of [{ ...weather(), dt: 'bad' }, { ...weather(), coord: {} },
    { ...weather(), wind: { speed: -1 } }, { ...weather(), main: { temp: '28', humidity: 100 } }]) {
    assert.throws(() => normalizeWeather(raw, { city: 'test' }, now), { statusCode: 502 });
  }
});

test('invalid/ambiguous query shapes never reach a provider', async () => {
  provider = () => { throw new Error('Should not request'); };
  for (const path of ['/weather/weather', '/weather/weather?city=x&latitude=0&longitude=0',
    '/weather/weather?latitude=0', '/marine/risk-prediction?latitude=0x10&longitude=0',
    '/marine/risk-prediction?latitude=1,2&longitude=0', '/marine/risk-prediction?latitude=NaN&longitude=0',
    '/marine/risk-prediction?latitude=1&latitude=2&longitude=0']) {
    assert.equal((await request(path)).status, 400, path);
  }
});

test('provider timeout, rate-limit, invalid data and failure responses have safe explicit errors', async () => {
  for (const [failure, status, code] of [[{ code: 'ECONNABORTED' }, 504, 'UPSTREAM_TIMEOUT'],
    [{ response: { status: 429, data: { message: 'secret' } } }, 503, 'PROVIDER_RATE_LIMITED'],
    [{ response: { status: 401, data: { message: 'secret' } } }, 502, 'UPSTREAM_ERROR'],
    [new Error('secret'), 502, 'UPSTREAM_ERROR']]) {
    provider = async () => { throw failure; };
    const response = await request('/marine/risk-prediction?latitude=0&longitude=0');
    assert.equal(response.status, status);
    assert.equal(response.body.code, code);
    assert.ok(!response.body.message.includes('secret'));
  }
  provider = async () => ({ data: { ...marine(), hourly_units: { wave_height: 'ft', time: 'unixtime' } } });
  assert.equal((await request('/marine/risk-prediction?latitude=0&longitude=0')).status, 502);
});

test('unconfigured weather and unknown cities return explicit unavailability without fallback data', async () => {
  const key = process.env.WEATHER_API_KEY;
  provider = async () => { throw new Error('Must not call an unconfigured provider'); };
  try {
    delete process.env.WEATHER_API_KEY;
    const missing = await request('/weather/weather?city=Test');
    assert.equal(missing.status, 503);
    assert.equal(missing.body.data, undefined);
    assert.equal(missing.body.code, 'SERVICE_UNAVAILABLE');
  } finally { process.env.WEATHER_API_KEY = key; }
  provider = async () => { throw { response: { status: 404 } }; };
  const unknown = await request('/weather/weather?city=Unknown');
  assert.equal(unknown.status, 404);
  assert.equal(unknown.body.data, undefined);
});
