import express from 'express';
import UserController from '../controller/UserController.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

// Public routes (no authentication required)
router.post('/register', UserController.registerUser);
router.post('/verify-otp', UserController.verifyOtp);
router.post('/verify-reset-otp', UserController.verifyResetOtp);
router.post('/reset-password', UserController.resetPassword);
router.post('/login', UserController.loginUser);
router.post('/forgot-password', UserController.forgotPassword);

// Protected routes (authentication required)
router.get('/profile', authenticateToken, UserController.getUserProfile);
router.get('/users', authenticateToken, UserController.fetchUsers);
router.put('/update-profile', authenticateToken, UserController.updateUserProfile);


export default router;