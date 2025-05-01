import express from 'express';
import RiskPredictionController from '../controller/RiskPredictionController.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

router.get('/risk-prediction', authenticateToken, RiskPredictionController.fetchWaveCondition);

export default router;
