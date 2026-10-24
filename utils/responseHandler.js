export const successResponse = (res, data, statusCode = 200, metadata = {}) => {
  res.status(statusCode).json({
    success: true,
    data,
    ...metadata,
  });
};

export { sendError as errorResponse } from '../middleware/errorHandler.js';
