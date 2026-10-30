import express from 'express';
import SosAlertController from '../controller/SosAlertController.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();
router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

//implementing the routes
router.post('/sos', authenticateToken, SosAlertController.saveSosMessage);
router.get('/active', authenticateToken, SosAlertController.getActiveSosAlerts);
router.get('/current', authenticateToken, SosAlertController.getCurrentReceipt);
router.patch('/:messageId/status', authenticateToken, SosAlertController.updateSosStatus);

export default router;
