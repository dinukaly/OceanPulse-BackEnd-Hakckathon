const listeners = new Set();

export function subscribeMessages(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// Notifications are best effort. A disconnected client recovers from durable REST history.
// A notification failure must never turn an acknowledged database write into a failed send.
export function publishMessageEvent(userIds, event) {
  for (const listener of listeners) {
    try { listener(new Set(userIds), event); } catch { /* recovery uses REST */ }
  }
}
