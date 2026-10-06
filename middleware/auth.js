import jwt from 'jsonwebtoken';
import { AppError } from './errorHandler.js';
import { config } from '../config/env.js'
import User from '../model/UserSchema.js';
import mongoose from 'mongoose';

export const verifyToken = (token) => {
  try {
    return jwt.verify(token, config.jwtSecret); 
  } catch (error) {
    throw new AppError('Invalid token', 401); 
  }
};

export const generateToken = (userId, username) => {
  return jwt.sign(
    { userId, username },
    config.jwtSecret,
    { expiresIn: '90d' } 
  );
};


export const authenticateToken = async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = /^Bearer (\S+)$/i.exec(authHeader || '')?.[1];

  if (!token) {
    return next(new AppError('Access denied. No token provided.', 401)); 
  }

  try {
    const decoded = verifyToken(token);
    if (!mongoose.isValidObjectId(decoded.userId)) {
      throw new AppError('Invalid token', 401);
    }
    const user = await User.findById(decoded.userId).select('_id username isActive');
    if (!user || !user.isActive) {
      throw new AppError('Account is not active', 401);
    }
    req.user = { userId: user._id.toString(), username: user.username };
    next(); 
  } catch (error) {
    next(error); 
  }
};
