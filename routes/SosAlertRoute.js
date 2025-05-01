import express from 'express';
import SosAlertController from '../controller/SosAlertController.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

//implementing the routes
router.post('/sos', authenticateToken, SosAlertController.saveSosMessage);
router.get('/active', authenticateToken, SosAlertController.getActiveSosAlerts);
router.patch('/:messageId/status', authenticateToken, SosAlertController.updateSosStatus);

export default router;
