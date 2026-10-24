import test, { after } from 'node:test';
import assert from 'node:assert/strict';

process.env.JWT_SECRET_KEY = 'test-only-signing-key';
process.env.WEATHER_API_KEY = 'test-only-weather-key';
const { default: Counter } = await import('../model/AuthRateLimitSchema.js');
const { authRateLimit } = await import('../middleware/authRateLimit.js');
const original = Counter.findOneAndUpdate;
after(() => { Counter.findOneAndUpdate = original; });

function memoryCounters() {
  const counts = new Map();
  Counter.findOneAndUpdate = async ({ _id }, update) => {
    assert.equal(update.$inc.count, 1);
    counts.set(_id, (counts.get(_id) || 0) + 1);
    return { count: counts.get(_id) };
  };
  return counts;
}
async function attempt(path, email, ip = '127.0.0.1') {
  const headers = {};
  let error;
  await authRateLimit({ path, body: { email }, ip }, { set: (key, value) => { headers[key] = value; } }, (err) => { error = err; });
  return { error, headers };
}

test('account limits span IPs and email casing and include successful attempts', async () => {
  const counts = memoryCounters();
  for (let i = 0; i < 20; i++) {
    assert.equal((await attempt('/login', 'fisher@example.com', `ip-${i}`)).error, undefined);
  }
  const blocked = await attempt('/LOGIN/', 'FISHER@example.com', 'another-ip');
  assert.equal(blocked.error.statusCode, 429);
  assert.ok(Number(blocked.headers['Retry-After']) > 0);
  assert.ok([...counts.keys()].every((key) => !key.includes('fisher')));
});

test('mail budget is shared across register, resend and forgot requests', async () => {
  memoryCounters();
  const paths = ['/register', '/resend-verification-otp', '/forgot-password'];
  for (let i = 0; i < 5; i++) assert.equal((await attempt(paths[i % 3], 'mail@example.com')).error, undefined);
  assert.equal((await attempt('/forgot-password', 'mail@example.com')).error.statusCode, 429);
});

test('IP limit bounds requests across different accounts', async () => {
  memoryCounters();
  for (let i = 0; i < 10; i++) assert.equal((await attempt('/register', `${i}@example.com`)).error, undefined);
  assert.equal((await attempt('/register', 'new@example.com')).error.statusCode, 429);
});

test('new time window permits requests even before expired counters are deleted', async () => {
  const now = Date.now;
  memoryCounters();
  try {
    Date.now = () => 900_000;
    for (let i = 0; i < 5; i++) await attempt('/register', 'window@example.com');
    assert.equal((await attempt('/register', 'window@example.com')).error.statusCode, 429);
    Date.now = () => 1_800_000;
    assert.equal((await attempt('/register', 'window@example.com')).error, undefined);
  } finally { Date.now = now; }
});

test('counter failures fail closed and concurrent first inserts are retried', async () => {
  Counter.findOneAndUpdate = async () => { throw new Error('Database unavailable'); };
  assert.equal((await attempt('/login', 'test@example.com')).error.statusCode, 503);
  let calls = 0;
  Counter.findOneAndUpdate = async (query, update, options) => {
    calls++;
    if (calls === 1) throw Object.assign(new Error('Duplicate'), { code: 11000 });
    if (calls === 2) assert.equal(options.upsert, undefined);
    return { count: 1 };
  };
  assert.equal((await attempt('/login', 'test@example.com')).error, undefined);
  assert.equal(calls, 3);
});
