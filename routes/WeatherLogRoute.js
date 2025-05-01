import express from 'express';
import WeatherLogController from '../controller/WeatherLogController.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

router.get('/weather', authenticateToken, WeatherLogController.getWeather);

export default router;