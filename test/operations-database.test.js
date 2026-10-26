import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomUUID, createHmac } from 'node:crypto';
import mongoose from 'mongoose';

const uri = process.env.OPS_TEST_MONGODB_URI;
test(
  'real MongoDB: operational readiness, proxy identity and bounded draining',
  { skip: !uri, timeout: 30000 },
  async (t) => {
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET_KEY = 'operations-database-test-key';
    const [
      { startServer },
      { config },
      { createLogger },
      { default: Counter },
    ] = await Promise.all([
      import('../app.js'),
      import('../config/env.js'),
      import('../utils/logger.js'),
      import('../model/AuthRateLimitSchema.js'),
    ]);
    const database = `oceanpulse_ops_test_${Date.now()}_${randomUUID().replaceAll('-', '').slice(0, 8)}`;
    const lines = [];
    const logger = createLogger({
      write: (line) => lines.push(JSON.parse(line)),
    });
    let runtime;
    try {
      runtime = await startServer({
        mongoUri: uri,
        dbName: database,
        port: 0,
        host: '127.0.0.1',
        logger,
        settings: { ...config, autoIndex: false, shutdownGraceMs: 100 },
      });
      await Promise.all(
        Object.values(mongoose.models).map((model) => model.init()),
      );
      const base = `http://127.0.0.1:${runtime.server.address().port}`;
      await t.test(
        'required indexes and actual Mongo ping pass even with automatic indexing disabled',
        async () => {
          assert.equal(
            (await fetch(base + '/api/v1/health/ready')).status,
            200,
          );
          assert.equal((await fetch(base + '/api/v1/health/live')).status, 200);
          const userIndexes = await mongoose.models.User.collection.indexes();
          assert.ok(
            userIndexes.some((index) => index.unique && index.key.email === 1),
          );
          const counters = await Counter.collection.indexes();
          assert.ok(counters.some((index) => index.expireAfterSeconds === 0));
        },
      );
      await t.test(
        'disconnect is unready without a restart loop; reconnection restores readiness',
        async () => {
          await mongoose.disconnect();
          assert.equal((await fetch(base + '/api/v1/health/live')).status, 200);
          assert.equal(
            (await fetch(base + '/api/v1/health/ready')).status,
            503,
          );
          assert.equal(
            (await fetch(base + '/api/v1/users/profile')).status,
            503,
          );
          await mongoose.connect(uri, {
            dbName: database,
            autoIndex: false,
            serverSelectionTimeoutMS: 5000,
          });
          assert.equal(
            (await fetch(base + '/api/v1/health/ready')).status,
            200,
          );
        },
      );
      await t.test(
        'direct clients cannot spoof IP rate-limit identities using forwarded headers',
        async () => {
          for (const forwarded of ['192.0.2.1', '198.51.100.20']) {
            const result = await fetch(base + '/api/v1/users/login', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'X-Forwarded-For': forwarded,
              },
              body: JSON.stringify({
                email: 'ops@example.test',
                password: 'WrongPassword123',
              }),
            });
            assert.equal(result.status, 401);
          }
          assert.equal(
            await Counter.countDocuments(),
            2,
            'one shared client IP bucket and one account bucket',
          );
          const window = Math.floor(Date.now() / (15 * 60 * 1000));
          const hash = createHmac('sha256', config.jwtSecret)
            .update('login:ip:127.0.0.1')
            .digest('hex');
          assert.equal((await Counter.findById(`${window}:${hash}`)).count, 2);
        },
      );
      await t.test(
        'draining rejects new work and upgrades, completes once and bounds an incomplete HTTP request',
        async () => {
          runtime.health.state.draining = true;
          assert.equal(
            (await fetch(base + '/api/v1/health/ready')).status,
            503,
          );
          assert.equal((await fetch(base + '/api/v1/health/live')).status, 200);
          runtime.health.state.draining = false;
          // Leave a JSON body incomplete: no handler can perform a write.
          const slow = http.request(base + '/api/v1/users/login', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Content-Length': '1024',
            },
          });
          slow.on('error', () => {});
          await new Promise((resolve) => {
            slow.on('socket', (socket) => {
              socket.once('connect', () => {
                slow.write('{');
                setTimeout(resolve, 30);
              });
            });
          });
          const first = runtime.close();
          assert.equal(first, runtime.close(), 'shutdown must be idempotent');
          const result = await first;
          slow.destroy();
          assert.equal(result.forced, true);
          assert.equal(mongoose.connection.readyState, 0);
          assert.ok(
            lines.some((line) => line.event === 'server.shutdown_timeout'),
          );
        },
      );
    } finally {
      try {
        if (runtime) await runtime.close();
      } finally {
        const cleanup = mongoose.createConnection(uri, {
          dbName: database,
          serverSelectionTimeoutMS: 5000,
        });
        try {
          await cleanup.asPromise();
          assert.equal(cleanup.name, database);
          assert.match(database, /^oceanpulse_ops_test_\d+_[a-f0-9]{8}$/);
          await cleanup.dropDatabase();
        } finally {
          await cleanup.close();
        }
      }
    }
  },
);
