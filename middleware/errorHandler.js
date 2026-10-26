import mongoose from 'mongoose';

class AppError extends Error {
  constructor(message, statusCode, code) {
    super(message);
    this.statusCode = statusCode;
    this.status = `${statusCode}`.startsWith('4') ? 'fail' : 'error';
    this.isOperational = true;
    this.code = code;

    Error.captureStackTrace(this, this.constructor);
  }
}

const codes = {
  400: 'VALIDATION_ERROR',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  413: 'PAYLOAD_TOO_LARGE',
  429: 'RATE_LIMITED',
  500: 'INTERNAL_ERROR',
  502: 'UPSTREAM_ERROR',
  503: 'SERVICE_UNAVAILABLE',
};

export const sendError = (
  res,
  message,
  statusCode = 500,
  code = codes[statusCode] || 'INTERNAL_ERROR',
) =>
  res.status(statusCode).json({
    success: false,
    status: statusCode < 500 ? 'fail' : 'error',
    code,
    message,
  });

const errorHandler = (err, req, res, next) => {
  const unavailable =
    [
      'MongoNetworkError',
      'MongoNetworkTimeoutError',
      'MongoServerSelectionError',
      'MongooseServerSelectionError',
      'MongoNotConnectedError',
      'MongoTopologyClosedError',
    ].includes(err.name) ||
    (err.name === 'MongooseError' && mongoose.connection.readyState !== 1);
  const log = (errorKind) =>
    res.locals?.logger?.error('request.failed', {
      requestId: res.locals.requestId,
      errorKind,
    });
  if (res.headersSent) {
    log('unexpected');
    return res.destroy();
  }
  if (unavailable) {
    log('unavailable');
    return sendError(res, 'Database temporarily unavailable', 503);
  }
  if (err.type === 'entity.parse.failed')
    return sendError(res, 'Invalid JSON body', 400);
  if (err.type === 'entity.too.large')
    return sendError(res, 'Request body too large', 413);
  if (err.name === 'ValidationError' || err.name === 'CastError')
    return sendError(res, 'Invalid request data', 400);
  if (err.code === 11000)
    return sendError(
      res,
      'A record with these unique fields already exists',
      409,
    );
  if (err.name === 'VersionError')
    return sendError(
      res,
      'Record changed during this request. Please retry.',
      409,
    );
  if (
    err.isOperational &&
    Number.isInteger(err.statusCode) &&
    err.statusCode >= 400 &&
    err.statusCode <= 599
  ) {
    if (err.statusCode >= 500) log('unavailable');
    return sendError(
      res,
      err.message,
      err.statusCode,
      err.code || codes[err.statusCode] || 'REQUEST_FAILED',
    );
  }
  log('unexpected');
  return sendError(res, 'An unexpected server error occurred', 500);
};

export { AppError, errorHandler };
