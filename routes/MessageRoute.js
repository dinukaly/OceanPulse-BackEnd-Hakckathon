import express from 'express';
import MessageController from '../controller/MessageController.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

// In MessageRoute.js (temporary)
router.post('/test-send', (req, res) => {
    res.send("Test POST on /messages/test-send works!");
  });
router.post('/send', authenticateToken, MessageController.sendMessage);
router.get('/get', authenticateToken, MessageController.getMessages);
router.post('/mark-read', authenticateToken, MessageController.markMessagesAsRead);

export default router;
