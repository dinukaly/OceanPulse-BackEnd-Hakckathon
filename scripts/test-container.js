import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import WebSocket from 'ws';

const args = process.argv.slice(2);
if (
  args.length !== 2 ||
  args[0] !== '--container' ||
  !/^[\w.-]+$/.test(args[1])
) {
  console.error(
    'Use --container NAME for the existing local MongoDB container on port 27017.',
  );
  process.exit(1);
}
const name = `oceanpulse-ops-check-${Date.now()}-${randomBytes(4).toString('hex')}`;
const database = `oceanpulse_container_test_${Date.now()}_${randomBytes(4).toString('hex')}`;
const docker = (parameters, env = process.env) =>
  execFileSync('docker', parameters, {
    encoding: 'utf8',
    timeout: 20000,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
let started = false;
let credentials;
let stage = 'setup';
let connection;

try {
  const values = JSON.parse(
    docker(['inspect', '--format', '{{json .Config.Env}}', args[1]]),
  );
  const env = Object.fromEntries(
    values.map((value) => {
      const equals = value.indexOf('=');
      return [value.slice(0, equals), value.slice(equals + 1)];
    }),
  );
  if (!env.MONGO_INITDB_ROOT_USERNAME || !env.MONGO_INITDB_ROOT_PASSWORD)
    throw new Error('Missing local container credentials');
  credentials = `${encodeURIComponent(env.MONGO_INITDB_ROOT_USERNAME)}:${encodeURIComponent(env.MONGO_INITDB_ROOT_PASSWORD)}`;
  const jwtSecret = randomBytes(32).toString('hex');
  docker(
    [
      'run',
      '--detach',
      '--name',
      name,
      '--read-only',
      '--cap-drop',
      'ALL',
      '--security-opt',
      'no-new-privileges:true',
      '--tmpfs',
      '/tmp:rw,noexec,nosuid,size=16m',
      '--add-host',
      'host.docker.internal:host-gateway',
      '--publish',
      '127.0.0.1::3000',
      '--env',
      'MONGODB_URI',
      '--env',
      'JWT_SECRET_KEY',
      '--env',
      'CORS_ALLOWED_ORIGINS',
      '--env',
      'SHUTDOWN_GRACE_MS=2000',
      'oceanpulse-api:ops-check',
    ],
    {
      ...process.env,
      MONGODB_URI: `mongodb://${credentials}@host.docker.internal:27017/${database}?authSource=admin`,
      JWT_SECRET_KEY: jwtSecret,
      CORS_ALLOWED_ORIGINS: 'https://web.example.test',
    },
  );
  started = true;
  const port = /^127\.0\.0\.1:(\d+)$/.exec(
    docker(['port', name, '3000/tcp']),
  )?.[1];
  assert.ok(port);
  const base = `http://127.0.0.1:${port}`;
  stage = 'readiness';
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      const response = await fetch(base + '/api/v1/health/ready', {
        signal: AbortSignal.timeout(1000),
      });
      await response.body?.cancel();
      if (response.status === 200) {
        ready = true;
        break;
      }
    } catch {}
    if (docker(['inspect', '--format', '{{.State.Running}}', name]) !== 'true')
      break;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  assert.ok(ready, 'Container did not become ready');
  assert.equal((await fetch(base + '/api/v1/health/live')).status, 200);
  assert.equal(
    (
      await fetch(base + '/api/v1/health/live', {
        headers: { Origin: 'https://evil.example.test' },
      })
    ).status,
    403,
  );

  stage = 'permissions';
  const host = JSON.parse(
    docker(['inspect', '--format', '{{json .HostConfig}}', name]),
  );
  assert.equal(host.ReadonlyRootfs, true);
  assert.ok(host.CapDrop.includes('ALL'));
  docker([
    'exec',
    name,
    'node',
    '--input-type=module',
    '-e',
    `
    import assert from 'node:assert/strict';
    import { existsSync, writeFileSync } from 'node:fs';
    assert.notEqual(process.getuid(), 0);
    for (const file of ['/app/.env', '/app/.env.production', '/app/.git']) assert.equal(existsSync(file), false);
    assert.throws(() => writeFileSync('/app/read-only-check', 'test'), error => error.code === 'EROFS');
  `,
  ]);
  docker(['exec', name, 'node', 'scripts/healthcheck.js']);

  stage = 'login';
  connection = await mongoose
    .createConnection(
      `mongodb://${credentials}@127.0.0.1:27017/?authSource=admin`,
      {
        dbName: database,
        serverSelectionTimeoutMS: 5000,
      },
    )
    .asPromise();
  await connection.db.collection('users').insertOne({
    username: 'container.test',
    firstName: 'Container',
    lastName: 'Test',
    email: 'container@example.test',
    contact: 'test',
    language: 'Sinhala',
    isActive: true,
    password: bcrypt.hashSync('ContainerPass123', 10),
    authVersion: 0,
    resetVersion: 0,
    __v: 0,
  });
  const login = await fetch(base + '/api/v1/users/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'container@example.test',
      password: 'ContainerPass123',
    }),
  });
  assert.equal(login.status, 200);
  const token = (await login.json()).data.token;
  assert.ok(token);

  stage = 'websocket';
  const ws = new WebSocket(
    base.replace('http:', 'ws:') + '/api/v1/messages/socket',
    {
      headers: { Origin: 'https://web.example.test' },
    },
  );
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.terminate();
      reject(new Error('Socket handshake deadline'));
    }, 5000);
    ws.on('error', reject);
    ws.on('open', () => ws.send(JSON.stringify({ type: 'auth', token })));
    ws.on('message', (data) => {
      if (JSON.parse(data.toString()).type === 'ready') {
        clearTimeout(timer);
        resolve();
      }
    });
  });
  const malformed = await fetch(
    base + '/api/v1/users/login?private=PRIVATE_SENTINEL',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer PRIVATE_SENTINEL',
      },
      body: '{"password":"PRIVATE_SENTINEL",',
    },
  );
  assert.equal(malformed.status, 400);
  assert.ok(malformed.headers.get('x-request-id'));

  stage = 'shutdown';
  await connection.close();
  connection = null;
  const closed = new Promise((resolve) => ws.once('close', resolve));
  docker(['stop', '--time', '5', name]);
  await closed;
  assert.equal(
    docker(['inspect', '--format', '{{.State.ExitCode}}', name]),
    '0',
  );
  const logs = docker(['logs', name]);
  for (const secret of [
    'PRIVATE_SENTINEL',
    'ContainerPass123',
    env.MONGO_INITDB_ROOT_PASSWORD,
    jwtSecret,
  ]) {
    assert.ok(
      !logs.includes(secret),
      'Container output must not contain sensitive data',
    );
  }
  assert.ok(logs.includes('server.stopped'));
  console.log(
    'Container verification passed: non-root/read-only, readiness, origin rules, real login/socket, safe logs and SIGTERM shutdown.',
  );
} catch (error) {
  console.error(
    `Container verification failed during ${stage} (${error.name}). No credentials or raw container output were printed.`,
  );
  process.exitCode = 1;
} finally {
  if (connection) await connection.close();
  if (started) {
    assert.match(name, /^oceanpulse-ops-check-\d+-[a-f0-9]{8}$/);
    try {
      docker(['rm', '--force', name]);
    } catch {
      process.exitCode = 1;
    }
  }
  if (credentials) {
    const cleanup = mongoose.createConnection(
      `mongodb://${credentials}@127.0.0.1:27017/?authSource=admin`,
      {
        dbName: database,
        serverSelectionTimeoutMS: 5000,
      },
    );
    try {
      await cleanup.asPromise();
      assert.equal(cleanup.name, database);
      assert.match(database, /^oceanpulse_container_test_\d+_[a-f0-9]{8}$/);
      await cleanup.dropDatabase();
    } finally {
      await cleanup.close();
    }
  }
}
