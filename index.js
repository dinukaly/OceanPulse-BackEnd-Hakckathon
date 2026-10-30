import { createLogger } from './utils/logger.js';

let logger = createLogger();
try {
  // Import inside the guard so invalid environment settings get a safe startup log.
  const { config } = await import('./config/env.js');
  logger = createLogger({ level: config.logLevel });
  const { startServer } = await import('./app.js');
  const runtime = await startServer({ logger });
  let stopping = false;
  const stop = async (signal) => {
    if (stopping) return;
    stopping = true;
    const deadline = setTimeout(() => {
      logger.error('server.shutdown_failed', {
        reason: signal,
        errorKind: 'unavailable',
      });
      process.exit(1);
    }, config.shutdownGraceMs + 2000);
    deadline.unref();
    try {
      const result = await runtime.close(signal);
      process.exitCode = result.forced ? 1 : 0;
    } catch {
      logger.error('server.shutdown_failed', {
        reason: signal,
        errorKind: 'unexpected',
      });
      process.exitCode = 1;
    } finally {
      clearTimeout(deadline);
    }
  };
  process.once('SIGTERM', () => {
    void stop('SIGTERM');
  });
  process.once('SIGINT', () => {
    void stop('SIGINT');
  });
} catch (error) {
  logger.error('server.start_failed', {
    errorKind:
      error.name === 'ConfigurationError'
        ? 'configuration'
        : error.code === 11000
          ? 'conflict'
          : 'unavailable',
    setting: error.field,
    errorCode: error.code,
  });
  process.exitCode = 1;
}
