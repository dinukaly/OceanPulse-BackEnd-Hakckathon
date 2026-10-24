import express from 'express';
import UserController from '../controller/UserController.js';
import { authenticateToken } from '../middleware/auth.js';
import { validateAuthRequest } from '../middleware/authValidation.js';
import { authRateLimit } from '../middleware/authRateLimit.js';

const router = express.Router();
router.use(validateAuthRequest, authRateLimit);

// Public routes (no authentication required)
router.post('/register', UserController.registerUser);
router.post('/verify-otp', UserController.verifyOtp);
router.post('/resend-verification-otp', UserController.resendVerification);
router.post('/verify-reset-otp', UserController.verifyResetOtp);
router.post('/reset-password', UserController.resetPassword);
router.post('/login', UserController.loginUser);
router.post('/forgot-password', UserController.forgotPassword);

// Protected routes (authentication required)
router.get('/profile', authenticateToken, UserController.getUserProfile);
router.get('/users', authenticateToken, UserController.fetchUsers);
router.put('/update-profile', authenticateToken, UserController.updateUserProfile);

router.use((error, req, res, next) => {
  if (error.name === 'VersionError') {
    return res.status(409).json({ success: false, message: 'Account changed during this request. Please try again.' });
  }
  next(error);
});


export default router;
