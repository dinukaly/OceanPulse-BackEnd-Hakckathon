import express from 'express';
import CommunityAlertController from '../controller/CommunityAlertController.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

router.get('/posts', authenticateToken, CommunityAlertController.getAllPosts);
router.post('/posts', authenticateToken, CommunityAlertController.createPost);
router.post('/posts/:postId/like', authenticateToken, CommunityAlertController.likePost);
router.post('/posts/:postId/comment', authenticateToken, CommunityAlertController.commentOnPost);

export default router;