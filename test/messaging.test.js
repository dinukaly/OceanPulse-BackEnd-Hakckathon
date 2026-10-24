import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createServer } from 'node:http';
import jwt from 'jsonwebtoken';
import { WebSocket } from 'ws';

process.env.JWT_SECRET_KEY = 'test-only-signing-key';
const [{ default: User }, { default: Message }, { default: routes }, { errorHandler },
  { attachMessageSocket }, { subscribeMessages, publishMessageEvent }] = await Promise.all([
  import('../model/UserSchema.js'), import('../model/MessageSchema.js'), import('../routes/MessageRoute.js'),
  import('../middleware/errorHandler.js'), import('../realtime/messageSocket.js'), import('../realtime/messageEvents.js'),
]);
const id = n => n.toString(16).padStart(24, '0');
const alice = id(1), bob = id(2), charlie = id(3), inactive = id(4);
const users = new Map([alice, bob, charlie, inactive].map(userId => [userId,
  { _id: userId, username: userId, isActive: userId !== inactive, authVersion: 0 }]));
const token = (userId, payload = {}, options = {}) => jwt.sign({ userId, purpose: 'access', authVersion: 0, ...payload },
  process.env.JWT_SECRET_KEY, { expiresIn: '1h', ...options });
const rows = [];
const undo = [];
const replace = (target, name, value) => { const old = target[name]; target[name] = value; undo.push(() => { target[name] = old; }); };
const matches = (row, filter) => Object.entries(filter).every(([key, value]) => {
  if (key === '$or') return value.some(part => matches(row, part));
  if (key === '$and') return value.every(part => matches(row, part));
  if (value && typeof value === 'object') return Object.entries(value).every(([op, operand]) =>
    op === '$in' ? operand.includes(String(row[key])) : op === '$ne' ? row[key] !== operand : op === '$lt' ? String(row[key]) < operand : false);
  return String(row[key]) === String(value);
});
const query = (filter, one = false) => {
  let limit = 100;
  const result = { sort() { return this; }, limit(n) { limit = n; return this; },
    read(value) { assert.equal(value, 'primary'); return this; },
    readConcern(value) { assert.equal(value, 'majority'); return this; },
    maxTimeMS(value) { assert.equal(value, 5000); return this; },
    lean: async () => rows.filter(row => matches(row, filter)).sort((a, b) => String(b._id).localeCompare(String(a._id))).slice(0, limit),
    then(resolve, reject) { return Promise.resolve(rows.find(row => matches(row, filter)) || null).then(resolve, reject); } };
  return result;
};
replace(User, 'findById', userId => ({ select: async () => users.get(String(userId)) || null }));
replace(Message, 'findOne', filter => query(filter, true));
replace(Message, 'find', filter => query(filter));
let failSave = false;
replace(Message.prototype, 'save', async function (options) {
  assert.equal(options.writeConcern.w, 'majority');
  if (failSave) throw new Error('private storage failure');
  await new Promise(resolve => setImmediate(resolve));
  if (this.clientMessageId && rows.some(row => row.senderId === this.senderId && row.clientMessageId === this.clientMessageId)) {
    const error = new Error('duplicate'); error.code = 11000; throw error;
  }
  rows.push(this.toObject());
  return this;
});
replace(Message, 'updateMany', async (filter, update, options) => {
  assert.equal(options.writeConcern.w, 'majority');
  const found = rows.filter(row => matches(row, filter));
  found.forEach(row => Object.assign(row, update.$set));
  return { acknowledged: true, modifiedCount: found.length };
});
replace(Message, 'aggregate', pipeline => ({ option: async () => {
  const counts = new Map();
  rows.filter(row => matches(row, pipeline[0].$match)).forEach(row => counts.set(row.senderId, (counts.get(row.senderId) || 0) + 1));
  return [...counts].map(([_id, count]) => ({ _id, count }));
} }));
const app = express();
app.use(express.json()); app.use('/api/v1/messages', routes); app.use(errorHandler);
const server = createServer(app);
const sockets = attachMessageSocket(server, { authTimeoutMs: 100, heartbeatMs: 1000 });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}/api/v1/messages`;
const request = async (path, body, actor = alice) => {
  const response = await fetch(base + path, { method: body ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${token(actor)}`, 'Content-Type': 'application/json' },
    ...(body && { body: JSON.stringify(body) }) });
  return { status: response.status, body: await response.json() };
};
const notices = [];
const unsubscribe = subscribeMessages((users, event) => notices.push({ users, event }));
after(async () => { unsubscribe(); sockets.close(); await new Promise(resolve => server.close(resolve)); undo.reverse().forEach(restore => restore()); });
const send = (overrides = {}) => ({ receiverId: bob, message: 'hello', clientMessageId: '10000000-0000-4000-8000-000000000001', ...overrides });
const waitFor = async predicate => {
  const until = Date.now() + 2500;
  while (!predicate()) {
    if (Date.now() > until) throw new Error('Timed out waiting for socket result');
    await new Promise(resolve => setTimeout(resolve, 5));
  }
};
async function connect(accessToken) {
  const ws = new WebSocket(base.replace('http:', 'ws:') + '/socket');
  const events = []; let closed;
  ws.on('message', data => events.push(JSON.parse(data.toString())));
  ws.on('close', code => { closed = code; });
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  if (accessToken !== undefined) ws.send(JSON.stringify({ type: 'auth', token: accessToken }));
  return { ws, events, get closed() { return closed; } };
}

test('concurrent same-key sends and lost-response retries return one durable message; conflicting reuse fails', async () => {
  const results = await Promise.all([request('/send', send()), request('/send', send())]);
  assert.deepEqual(results.map(result => result.status).sort(), [200, 201]);
  assert.equal(results[0].body.data.id, results[1].body.data.id);
  assert.equal(rows.length, 1);
  const retry = await request('/send', send());
  assert.equal(retry.body.data.id, results[0].body.data.id);
  assert.equal(retry.body.data.read, false);
  assert.equal((await request('/send', send({ message: 'changed' }))).status, 409);
  assert.equal((await request('/send', send({ receiverId: charlie }))).status, 409);
});

test('invalid IDs/content, unavailable recipients and failed persistence never publish successful sends', async () => {
  const before = notices.length;
  for (const [body, status] of [[send({ clientMessageId: 'bad' }), 400], [send({ message: ' ' }), 400],
    [send({ clientMessageId: undefined, receiverId: inactive }), 404], [send({ clientMessageId: undefined, receiverId: id(99) }), 404],
    [send({ clientMessageId: undefined, senderId: bob }), 403]]) {
    assert.equal((await request('/send', body)).status, status);
  }
  failSave = true;
  try { assert.equal((await request('/send', send({ clientMessageId: undefined }))).status, 500); }
  finally { failSave = false; }
  assert.equal(notices.length, before);
});

test('only recipients can mark read; repeated acknowledgements retain timestamps and counts recover from storage', async () => {
  const messageId = String(rows[0]._id);
  const count = await request('/unread', { senderIds: [alice] }, bob);
  assert.deepEqual(count.body.data, [{ senderId: alice, count: 1 }]);
  assert.deepEqual((await request('/unread', { senderIds: [alice], userId: bob }, charlie)).body.data, []);
  assert.deepEqual((await request('/mark-read', { messageIds: [messageId] }, charlie)).body.data.receipts, []);
  assert.equal(rows[0].read, false);
  const read = await request('/mark-read', { messageIds: [messageId] }, bob);
  assert.equal(read.body.data.modifiedCount, 1);
  const retry = await request('/mark-read', { messageIds: [messageId] }, bob);
  assert.equal(retry.body.data.modifiedCount, 0);
  assert.equal(retry.body.data.receipts[0].readAt, read.body.data.receipts[0].readAt);
  assert.deepEqual((await request('/unread', { senderIds: [alice] }, bob)).body.data, []);
  assert.equal((await request('/receipts', { messageIds: [messageId] })).body.data[0].read, true);
  assert.deepEqual((await request('/receipts', { messageIds: [messageId] }, charlie)).body.data, []);
  assert.equal((await request('/receipts', { messageIds: Array(101).fill(messageId) })).status, 400);
});

test('WebSocket authenticates before any event and publishes saved messages/receipts only to participants', async () => {
  const a = await connect(token(alice)), b = await connect(token(bob)), c = await connect(token(charlie));
  try {
    await waitFor(() => [a, b, c].every(client => client.events[0]?.type === 'ready'));
    const sent = await request('/send', send({ clientMessageId: '10000000-0000-4000-8000-000000000002' }));
    await waitFor(() => a.events.some(event => event.type === 'message.saved') && b.events.some(event => event.type === 'message.saved'));
    assert.equal(b.events.find(event => event.type === 'message.saved').message.id, sent.body.data.id);
    await request('/mark-read', { messageIds: [sent.body.data.id] }, bob);
    await waitFor(() => a.events.some(event => event.type === 'messages.read'));
    assert.deepEqual(c.events.map(event => event.type).filter(type => type !== 'heartbeat'), ['ready']);
    assert.equal(a.events.find(event => event.type === 'messages.read').receipts[0].id, sent.body.data.id);
  } finally { [a, b, c].forEach(client => client.ws.terminate()); }
});

test('missing, invalid, reset-purpose, inactive, expired and revoked socket sessions cannot subscribe', async () => {
  for (const accessToken of [undefined, 'invalid', token(alice, { purpose: 'reset-password' }), token(inactive),
    token(alice, {}, { expiresIn: -1 }), token(alice, { authVersion: 999 })]) {
    const client = await connect(accessToken);
    await waitFor(() => client.closed !== undefined);
    assert.equal(client.closed, 4401);
    assert.equal(client.events.length, 0);
  }
});

test('revoking a live account blocks its very next payload; sockets cannot choose another user room', async () => {
  const revoked = await connect(token(charlie));
  await waitFor(() => revoked.events.some(event => event.type === 'ready'));
  users.get(charlie).authVersion++;
  publishMessageEvent([charlie], { type: 'message.saved', message: { private: 'must not arrive' } });
  await waitFor(() => revoked.closed !== undefined);
  assert.equal(revoked.closed, 4401);
  assert.equal(revoked.events.some(event => event.type === 'message.saved'), false);
  const client = await connect(token(alice));
  await waitFor(() => client.events.some(event => event.type === 'ready'));
  client.ws.send(JSON.stringify({ type: 'subscribe', userId: bob }));
  await waitFor(() => client.closed !== undefined);
  assert.equal(client.closed, 4400);
});

test('socket path rejects query credentials and per-user connection capacity is bounded', async () => {
  const ws = new WebSocket(base.replace('http:', 'ws:') + '/socket?token=not-a-real-secret');
  const status = await new Promise(resolve => { ws.on('unexpected-response', (request, response) => { response.resume(); resolve(response.statusCode); ws.terminate(); }); ws.on('error', () => {}); });
  assert.equal(status, 404);
  const clients = [];
  try {
    for (let i = 0; i < 6; i++) {
      const client = await connect(token(bob)); clients.push(client);
      await waitFor(() => client.events.length || client.closed !== undefined);
    }
    assert.equal(clients.at(-1).closed, 4429);
  } finally { clients.forEach(client => client.ws.terminate()); }
});
