import { randomUUID } from 'node:crypto';

export function requestLog(logger) {
  return (req, res, next) => {
    const start = performance.now();
    const requestId = randomUUID();
    res.locals.requestId = requestId;
    res.locals.logger = logger;
    res.set('X-Request-ID', requestId);
    res.set('Cache-Control', 'no-store');
    let complete = false;
    const record = (aborted) => {
      if (complete) return;
      complete = true;
      const route = req.route?.path
        ? `${req.baseUrl || ''}${req.route.path}`
        : 'unmatched';
      if (
        !aborted &&
        res.statusCode < 400 &&
        /^\/api\/v1\/health\//.test(route)
      )
        return;
      const severity =
        aborted || res.statusCode >= 500
          ? 'error'
          : res.statusCode >= 400
            ? 'warn'
            : 'info';
      logger[severity](aborted ? 'http.aborted' : 'http.completed', {
        requestId,
        route,
        method: req.method,
        statusCode: aborted ? undefined : res.statusCode,
        durationMs: performance.now() - start,
      });
    };
    res.once('finish', () => record(false));
    res.once('close', () => record(!res.writableFinished));
    next();
  };
}
