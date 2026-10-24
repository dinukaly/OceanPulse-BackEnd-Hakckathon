import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';

process.env.JWT_SECRET_KEY = 'test-only-signing-key';
const [{ default: User }, { default: Sos }, { default: routes }, { errorHandler }] = await Promise.all([
  import('../model/UserSchema.js'), import('../model/SosAlertSchema.js'), import('../routes/SosAlertRoute.js'), import('../middleware/errorHandler.js'),
]);
const alice = '507f1f77bcf86cd799439011';
const bob = '507f1f77bcf86cd799439012';
const originals = { user: User.findById, upsert: Sos.findOneAndUpdate, find: Sos.findOne };
const records = new Map();
let writes, lookup, upsert;
const defaultUpsert = async (filter, update, options) => {
  assert.deepEqual(filter, { userId: filter.userId, isHandled: false });
  assert.deepEqual(Object.keys(update), ['$setOnInsert']);
  assert.equal(options.upsert, true);
  assert.equal(options.rawResult, true);
  assert.equal(options.new, true);
  assert.equal(options.runValidators, true);
  assert.equal(options.writeConcern.w, 'majority');
  assert.equal(options.maxTimeMS, 5000);
  const existing = records.get(filter.userId);
  if (!existing) {
    records.set(filter.userId, { _id: new mongoose.Types.ObjectId(), ...update.$setOnInsert });
    writes++;
  }
  return { ok: 1, value: records.get(filter.userId), lastErrorObject: { n: 1, updatedExisting: Boolean(existing) } };
};
User.findById = id => ({ select: async () => ({ _id: id, username: id === alice ? 'alice' : 'bob', isActive: true, authVersion: 0 }) });
Sos.findOneAndUpdate = (...args) => upsert(...args);
Sos.findOne = filter => {
  const query = {
    read: value => { assert.equal(value, 'primary'); return query; },
    readConcern: value => { assert.equal(value, 'majority'); return query; },
    maxTimeMS: value => { assert.equal(value, 5000); return query; },
    then: (resolve, reject) => Promise.resolve().then(() => lookup(filter)).then(resolve, reject),
  };
  return query;
};
beforeEach(() => {
  records.clear(); writes = 0;
  upsert = defaultUpsert;
  lookup = async filter => records.get(filter.userId) || null;
});
const app = express();
app.use(express.json());
app.use('/sos', routes);
app.use(errorHandler);
const server = app.listen(0);
const request = async (path, { body, actor = alice, method = body ? 'POST' : 'GET' } = {}) => {
  const response = await fetch(`http://127.0.0.1:${server.address().port}/sos${path}`, {
    method, headers: { 'Content-Type': 'application/json', ...(actor && { Authorization: `Bearer ${jwt.sign({ userId: actor, purpose: 'access', authVersion: 0 }, process.env.JWT_SECRET_KEY)}` }) },
    ...(body && { body: JSON.stringify(body) }),
  });
  return { status: response.status, body: await response.json(), cache: response.headers.get('cache-control') };
};
after(async () => {
  User.findById = originals.user; Sos.findOneAndUpdate = originals.upsert; Sos.findOne = originals.find;
  await new Promise(resolve => server.close(resolve));
});

test('concurrent HTTP retries receive one stable receipt and original location/time in the model stub', async () => {
  const results = await Promise.all(Array.from({ length: 20 }, (_, n) => request('/sos', { body: { latitude: n, longitude: n } })));
  assert.equal(writes, 1);
  assert.equal(results.filter(result => result.status === 201).length, 1);
  assert.equal(results.filter(result => result.status === 200).length, 19);
  assert.equal(new Set(results.map(result => result.body.data.id)).size, 1);
  assert.equal(new Set(results.map(result => result.body.data.receivedAt)).size, 1);
  assert.equal(new Set(results.map(result => JSON.stringify(result.body.data.location))).size, 1);
  assert.ok(results.every(result => result.body.data.responderNotified === false && result.cache === 'no-store'));
  const original = records.get(alice);
  const retry = await request('/sos', { body: { latitude: 80, longitude: 150 } });
  assert.equal(retry.body.data.receivedAt, original.timestamp.toISOString());
  assert.deepEqual(retry.body.data.location, { latitude: original.latitude, longitude: original.longitude });
  assert.equal(retry.body.data.alreadyActive, true);
});

test('a unique-index collision returns the winner without making another write', async () => {
  await request('/sos', { body: { latitude: 0, longitude: 0 } });
  const id = String(records.get(alice)._id);
  upsert = async () => { throw { code: 11000, keyPattern: { userId: 1 } }; };
  const retry = await request('/sos', { body: { latitude: 1, longitude: 1 } });
  assert.equal(retry.status, 200);
  assert.equal(retry.body.data.id, id);
  assert.deepEqual(retry.body.data.location, { latitude: 0, longitude: 0 });
  assert.equal(writes, 1);
});

test('missing collision winner and invalid write metadata never return confirmation', async () => {
  upsert = async () => { throw { code: 11000, keyPattern: { userId: 1 } }; };
  const missing = await request('/sos', { body: { latitude: 0, longitude: 0 } });
  assert.equal(missing.status, 503);
  assert.equal(missing.body.code, 'SOS_RECEIPT_UNCONFIRMED');
  upsert = async () => ({ ok: 1, value: null, lastErrorObject: { n: 0, updatedExisting: false } });
  assert.equal((await request('/sos', { body: { latitude: 0, longitude: 0 } })).status, 503);
  upsert = async () => { throw { code: 11000, keyPattern: { _id: 1 } }; };
  assert.equal((await request('/sos', { body: { latitude: 0, longitude: 0 } })).status, 409);
});

test('receipt recovery is owner-scoped, read-only and can find a write whose response was lost', async () => {
  upsert = async (...args) => { await defaultUpsert(...args); throw new Error('Write response lost'); };
  assert.equal((await request('/sos', { body: { latitude: 0, longitude: 0 } })).status, 500);
  const result = await request(`/current?userId=${bob}`);
  assert.equal(result.status, 200);
  assert.equal(result.body.data.receipt.id, String(records.get(alice)._id));
  assert.equal(result.body.data.receipt.alreadyActive, true);
  assert.equal(result.body.data.receipt.responderNotified, false);
  assert.equal(writes, 1);
  assert.equal((await request('/current', { actor: bob })).body.data.receipt, null);
  assert.equal((await request('/current', { actor: null })).status, 401);
});

test('legacy missing receipt metadata stays unknown and another owner cannot be confirmed', async () => {
  const legacy = { _id: new mongoose.Types.ObjectId(), userId: alice, username: 'alice', isHandled: false };
  records.set(alice, legacy);
  const result = await request('/current');
  assert.equal(result.body.data.receipt.receivedAt, null);
  assert.equal(result.body.data.receipt.location, null);
  lookup = async () => ({ ...legacy, userId: bob });
  assert.equal((await request('/current')).status, 503);
});

test('invalid coordinates and impersonation are rejected before writes; closure remains disabled', async () => {
  for (const body of [{ latitude: null, longitude: 0 }, { latitude: 91, longitude: 0 },
    { latitude: '0', longitude: 0 }, { latitude: 0, longitude: [] }]) {
    assert.equal((await request('/sos', { body })).status, 400);
  }
  assert.equal((await request('/sos', { body: { userId: bob, latitude: 0, longitude: 0 } })).status, 403);
  assert.equal(writes, 0);
  assert.equal((await request('/record/status', { body: { isHandled: true }, method: 'PATCH' })).status, 403);
});
