import express from 'express';
import BoatLocationController from '../controller/BoatLocationController.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

router.post('/update', authenticateToken, BoatLocationController.updateLocation);
router.get('/user/:userId', authenticateToken, BoatLocationController.getBoatLocation);
router.get('/nearby', authenticateToken, BoatLocationController.getNearbyBoats);

export default router;
