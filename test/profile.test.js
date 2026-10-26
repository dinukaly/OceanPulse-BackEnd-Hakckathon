import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import jwt from 'jsonwebtoken';

process.env.JWT_SECRET_KEY = 'test-only-signing-key';
const [{ default: User }, { default: userRoutes }, { errorHandler }] =
  await Promise.all([
    import('../model/UserSchema.js'),
    import('../routes/UserRoute.js'),
    import('../middleware/errorHandler.js'),
  ]);
const aliceId = '000000000000000000000001';
const bobId = '000000000000000000000002';
const accounts = new Map(
  [aliceId, bobId].map((id, index) => [
    id,
    {
      _id: id,
      firstName: index === 0 ? 'Alice' : 'Bob',
      lastName: 'Fisher',
      username: index === 0 ? 'alice' : 'bob',
      email: `${index}@example.test`,
      contact: '+94770000000',
      language: 'Sinhala',
      boatId: 'BOAT1',
      isActive: true,
      authVersion: 0,
      password: 'private-hash',
      __v: 0,
    },
  ]),
);
const original = User.findById;
let saves = 0;
User.findById = (id) => {
  const stored = accounts.get(String(id));
  const snapshot = stored ? { ...stored } : null;
  if (snapshot) {
    snapshot.save = async (options) => {
      assert.equal(options.w, 'majority');
      assert.equal(options.wtimeout, 5000);
      await new Promise((resolve) => setImmediate(resolve));
      if (accounts.get(String(id)).__v !== snapshot.__v) {
        const error = new Error('Private concurrency detail');
        error.name = 'VersionError';
        throw error;
      }
      const { save, ...persisted } = snapshot;
      persisted.__v++;
      accounts.set(String(id), persisted);
      snapshot.__v = persisted.__v;
      saves++;
      return snapshot;
    };
  }
  return {
    select: async () => snapshot,
    then: (resolve, reject) => Promise.resolve(snapshot).then(resolve, reject),
  };
};
const app = express();
app.use(express.json());
app.use('/users', userRoutes);
app.use(errorHandler);
const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
const request = async (body, actor = aliceId) => {
  const response = await fetch(
    base + (body ? '/users/update-profile' : '/users/profile'),
    {
      method: body ? 'PUT' : 'GET',
      headers: {
        Authorization: `Bearer ${jwt.sign({ userId: actor, purpose: 'access', authVersion: 0 }, process.env.JWT_SECRET_KEY)}`,
        'Content-Type': 'application/json',
      },
      ...(body && { body: JSON.stringify(body) }),
    },
  );
  return { status: response.status, body: await response.json() };
};
after(async () => {
  await new Promise((resolve) => server.close(resolve));
  User.findById = original;
});

test('profile save persists the normalized editable fields and version across independent reads', async () => {
  const initial = await request();
  assert.equal(initial.body.data.profileVersion, 0);
  const saved = await request({
    firstName: ' Updated ',
    boatId: '',
    language: 'Tamil',
    expectedVersion: 0,
  });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.data.user.firstName, 'Updated');
  assert.equal(saved.body.data.user.boatId, '');
  assert.equal(saved.body.data.profileVersion, 1);
  assert.deepEqual((await request()).body.data, {
    user: saved.body.data.user,
    profileVersion: 1,
  });
  assert.equal(accounts.get(aliceId).password, 'private-hash');
  assert.equal(accounts.get(bobId).firstName, 'Bob');
  assert.equal(saved.body.data.user.__v, undefined);
});

test('stale edits conflict before mutation and valid partial edits preserve unsupplied fields', async () => {
  const before = saves;
  const stale = await request({ contact: 'changed', expectedVersion: 0 });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.code, 'PROFILE_CONFLICT');
  assert.equal(saves, before);
  assert.equal(accounts.get(aliceId).contact, '+94770000000');
  const fresh = await request({ contact: 'new contact', expectedVersion: 1 });
  assert.equal(fresh.status, 200);
  assert.equal(fresh.body.data.user.language, 'Tamil');
  assert.equal(fresh.body.data.user.firstName, 'Updated');
});

test('profile rejects invalid versions/read-only fields and does not allow version-only updates', async () => {
  const before = saves;
  for (const body of [
    { firstName: 'valid', expectedVersion: '2' },
    { firstName: 'valid', expectedVersion: -1 },
    { firstName: 'valid', expectedVersion: 1.5 },
    { firstName: 'valid', expectedVersion: { $ne: 0 } },
    { firstName: 'valid', expectedVersion: Number.MAX_SAFE_INTEGER + 1 },
    { expectedVersion: 2 },
    { email: 'changed@example.test', expectedVersion: 2 },
    { userId: bobId, firstName: 'wrong account' },
  ]) {
    const result = await request(body);
    assert.equal(result.status, 400);
  }
  assert.equal(saves, before);
});

test('simultaneous same-version profile updates cannot both overwrite the account', async () => {
  const version = accounts.get(aliceId).__v;
  const results = await Promise.all([
    request({ firstName: 'First update', expectedVersion: version }),
    request({ firstName: 'Second update', expectedVersion: version }),
  ]);
  assert.deepEqual(results.map((result) => result.status).sort(), [200, 409]);
  const winner = results.find((result) => result.status === 200);
  assert.equal(
    (await request()).body.data.user.firstName,
    winner.body.data.user.firstName,
  );
});

test('legacy callers without expectedVersion can still submit validated partial updates', async () => {
  const saved = await request({ boatId: 'LEGACY' }, bobId);
  assert.equal(saved.status, 200);
  assert.equal(
    (await request(undefined, bobId)).body.data.user.boatId,
    'LEGACY',
  );
});
