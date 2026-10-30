import { execFileSync, spawn } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';

const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);

async function run() {
  let uri = process.env.INTEGRATION_TEST_MONGODB_URI;
  if (args.length) {
    if (
      args.length !== 2 ||
      args[0] !== '--container' ||
      !/^[\w.-]+$/.test(args[1])
    ) {
      throw new Error(
        'Use --container NAME, or set INTEGRATION_TEST_MONGODB_URI.',
      );
    }
    if (uri)
      throw new Error('Choose either the test URI or --container, not both.');
    const values = JSON.parse(
      execFileSync(
        'docker',
        ['inspect', '--format', '{{json .Config.Env}}', args[1]],
        {
          encoding: 'utf8',
          timeout: 10000,
          stdio: ['ignore', 'pipe', 'ignore'],
        },
      ),
    );
    const env = Object.fromEntries(
      values.map((value) => {
        const equals = value.indexOf('=');
        return [value.slice(0, equals), value.slice(equals + 1)];
      }),
    );
    if (!env.MONGO_INITDB_ROOT_USERNAME || !env.MONGO_INITDB_ROOT_PASSWORD) {
      throw new Error(
        'Container credentials are unavailable; set an explicit test URI instead.',
      );
    }
    uri = `mongodb://${encodeURIComponent(env.MONGO_INITDB_ROOT_USERNAME)}:${encodeURIComponent(env.MONGO_INITDB_ROOT_PASSWORD)}@127.0.0.1:27017/?authSource=admin`;
  }
  if (!uri) {
    throw new Error(
      'Set INTEGRATION_TEST_MONGODB_URI or pass --container NAME. The application URI is never used.',
    );
  }

  // Fail before spawning tests if authentication is unavailable. Do not print the URI.
  const probe = mongoose.createConnection(uri, {
    dbName: 'oceanpulse_integration_connectivity',
    serverSelectionTimeoutMS: 5000,
  });
  try {
    await probe.asPromise();
    await probe.db.command({ listCollections: 1, nameOnly: true });
    console.log(
      'Authenticated test database access verified. Each suite uses a disposable database.',
    );
  } finally {
    await probe.close();
  }

  const env = { ...process.env };
  env.NODE_ENV = 'test';
  for (const key of ['AUTH', 'API', 'SOS', 'MESSAGING', 'JOURNEY', 'OPS']) {
    env[`${key}_TEST_MONGODB_URI`] = uri;
  }
  const files = readdirSync(new URL('../test/', import.meta.url))
    .filter((name) => name.endsWith('.test.js'))
    .sort()
    .map((name) => `test/${name}`);
  const child = spawn(
    process.execPath,
    ['--test', '--test-timeout=90000', ...files],
    {
      cwd: root,
      env,
      stdio: 'inherit',
    },
  );
  process.exitCode = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code) => resolve(code ?? 1));
  });
}

try {
  await run();
} catch (error) {
  // Configuration/driver errors may contain credentials; print only our own guidance or safe metadata.
  const guidance = error.constructor === Error && !error.code && !error.syscall;
  console.error(
    guidance
      ? error.message
      : `Integration setup failed (${error.name}, code ${error.code ?? 'unknown'}). Check local test credentials and permissions.`,
  );
  process.exitCode = 1;
}
