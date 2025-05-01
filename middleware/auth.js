import jwt from 'jsonwebtoken';
import { AppError } from './errorHandler.js';
import { config } from '../config/env.js'

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


export const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; 

  if (!token) {
    return next(new AppError('Access denied. No token provided.', 401)); 
  }

  try {
    const decoded = verifyToken(token); 
    req.user = decoded; 
    next(); 
  } catch (error) {
    next(error); 
  }
};
