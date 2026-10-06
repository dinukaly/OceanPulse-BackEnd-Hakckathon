import { AppError } from './errorHandler.js';
import User from '../model/UserSchema.js';
import mongoose from 'mongoose';
import { verifyJwt } from '../utils/jwt.js';

export const verifyToken = (token) => {
  try {
    return verifyJwt(token);
  } catch (error) {
    throw new AppError('Invalid token', 401); 
  }
};

export const authenticateToken = async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = /^Bearer (\S+)$/i.exec(authHeader || '')?.[1];

  if (!token) {
    return next(new AppError('Access denied. No token provided.', 401)); 
  }

  try {
    const decoded = verifyToken(token);
    if (decoded.purpose !== 'access' || !mongoose.isValidObjectId(decoded.userId)) {
      throw new AppError('Invalid token', 401);
    }
    const user = await User.findById(decoded.userId).select('_id username isActive authVersion');
    if (!user || !user.isActive || decoded.authVersion !== (user.authVersion || 0)) {
      throw new AppError('Account is not active', 401);
    }
    req.user = { userId: user._id.toString(), username: user.username };
    next(); 
  } catch (error) {
    next(error); 
  }
};
