// No environment-file loading, configuration output, or response-body logging.
const port = process.env.PORT || '3000';
const readinessMs = Number(process.env.READINESS_TIMEOUT_MS || 1500);
try {
  if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535)
    throw new Error();
  if (!Number.isInteger(readinessMs) || readinessMs < 50 || readinessMs > 5000)
    throw new Error();
  const response = await fetch(`http://127.0.0.1:${port}/api/v1/health/ready`, {
    signal: AbortSignal.timeout(readinessMs + 500),
  });
  await response.body?.cancel();
  process.exitCode = response.ok ? 0 : 1;
} catch {
  process.exitCode = 1;
}
