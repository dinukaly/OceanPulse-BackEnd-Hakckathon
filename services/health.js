export function createHealth({ connected, ping, timeoutMs }) {
  const state = { initialized: false, draining: false };
  let inFlight;
  const accepting = () => state.initialized && !state.draining && connected();
  const ready = async () => {
    if (!accepting()) return false;
    if (!inFlight) {
      // Keep one shared transport probe even after a response deadline expires.
      const pending = Promise.resolve()
        .then(ping)
        .then(
          () => true,
          () => false,
        );
      inFlight = pending;
      pending.finally(() => {
        if (inFlight === pending) inFlight = null;
      });
    }
    let timer;
    try {
      const result = await Promise.race([
        inFlight,
        new Promise((resolve) => {
          timer = setTimeout(() => resolve(false), timeoutMs);
        }),
      ]);
      return result && accepting();
    } finally {
      clearTimeout(timer);
    }
  };
  return { state, accepting, ready };
}
