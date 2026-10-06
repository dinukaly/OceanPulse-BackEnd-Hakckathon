import express from 'express';
import MessageController from '../controller/MessageController.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

router.post('/send', authenticateToken, MessageController.sendMessage);
router.get('/get', authenticateToken, MessageController.getMessages);
router.post('/mark-read', authenticateToken, MessageController.markMessagesAsRead);

export default router;
