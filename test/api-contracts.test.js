import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import jwt from 'jsonwebtoken';

process.env.JWT_SECRET_KEY = 'test-only-signing-key';
process.env.WEATHER_API_KEY = 'test-only-weather-key';
const [{ default: User }, { default: Message }, { default: Post }, { default: Sos },
  { default: userRoutes }, { default: messageRoutes }, { default: postRoutes }, { default: sosRoutes },
  { default: boatRoutes }, { AppError, errorHandler }, { default: weatherRoutes }, { default: marineRoutes }] = await Promise.all([
  import('../model/UserSchema.js'), import('../model/MessageSchema.js'), import('../model/CommunityAlertSchema.js'),
  import('../model/SosAlertSchema.js'), import('../routes/UserRoute.js'), import('../routes/MessageRoute.js'),
  import('../routes/CommunityAlertRoute.js'), import('../routes/SosAlertRoute.js'), import('../routes/BoatLocationRoute.js'),
  import('../middleware/errorHandler.js'),
  import('../routes/WeatherLogRoute.js'), import('../routes/RiskPredictionRoute.js'),
]);
const id = n => n.toString(16).padStart(24, '0');
const alice = { _id: id(1), firstName: 'Alice', lastName: 'Fisher', username: 'alice', email: 'private@example.com',
  contact: '+94771234567', language: 'Tamil', boatId: 'B001', isActive: true, authVersion: 0,
  password: 'must-not-leak', verificationCodeHash: 'private-code', save: async function () { return this; } };
const members = [alice, ...[2, 3, 4, 5, 6].map(n => ({ ...alice, _id: id(n), username: `user${n}`, isActive: n !== 4 }))];
const messages = [10, 11, 12, 13, 14].map(n => ({ _id: id(n), senderId: id(1), receiverId: id(2), message: `message${n}`,
  timestamp: new Date('2026-10-24'), read: false }));
messages.push({ ...messages[0], _id: id(15), senderId: id(3), receiverId: id(2) });
const comments = [20, 21, 22, 23].map(n => ({ _id: id(n), userId: id(2), username: 'user2', content: 'comment', createdAt: new Date() }));
const posts = [30, 31, 32].map(n => ({ _id: id(n), userId: id(2), username: 'user2', content: 'post', comments, likes: 0, createdAt: new Date() }));
const alerts = [40, 41, 42].map(n => ({ _id: id(n), userId: id(1), isHandled: false }));
alerts.push({ _id: id(43), userId: id(2), isHandled: false });
const undo = [];
const replace = (target, key, value) => { const original = target[key]; target[key] = value; undo.push(() => { target[key] = original; }); };
const matches = (row, query) => Object.entries(query).every(([key, value]) => {
  if (key === '$and') return value.every(part => matches(row, part));
  if (key === '$or') return value.some(part => matches(row, part));
  if (value && typeof value === 'object') return Object.entries(value).every(([op, v]) =>
    op === '$lt' ? row[key] < v : op === '$ne' ? row[key] !== v : false);
  return row[key] === value;
});
let lastQuery;
function query(rows, filter = {}, projection = '') {
  let maximum;
  let selected = projection;
  const result = {
    select: value => { selected = value; return result; },
    sort: value => { assert.deepEqual(value, { _id: -1 }); return result; },
    limit: value => { maximum = value; return result; },
    lean: async () => {
      assert.ok(maximum > 0 && maximum <= 51, 'query must have a bounded limit');
      lastQuery = { filter, projection: selected, maximum };
      return rows.filter(row => matches(row, filter)).sort((a, b) => b._id.localeCompare(a._id)).slice(0, maximum).map(row => {
        if (selected === '-comments') { const { comments, ...rest } = row; return rest; }
        return row;
      });
    },
  };
  return result;
}
replace(User, 'findById', () => ({ select: async () => alice, then: (resolve, reject) => Promise.resolve(alice).then(resolve, reject) }));
replace(User, 'find', (filter, projection) => query(members, filter, projection));
replace(Message, 'find', filter => query(messages, filter));
replace(Post, 'find', filter => query(posts, filter));
replace(Sos, 'find', filter => query(alerts, filter));
replace(Post, 'aggregate', async pipeline => {
  if (!posts.some(post => post._id === String(pipeline[0].$match._id))) return [{ exists: [], items: [] }];
  const stages = pipeline[1].$facet.items;
  const before = stages.find(stage => stage.$match)?.$match['comments._id'].$lt;
  const limit = stages.find(stage => stage.$limit).$limit;
  assert.ok(limit <= 51);
  return [{ exists: [{ _id: id(30) }], items: comments.filter(comment => !before || comment._id < String(before))
    .sort((a, b) => b._id.localeCompare(a._id)).slice(0, limit) }];
});
const app = express();
app.use(express.json());
app.use('/users', userRoutes);
app.use('/messages', messageRoutes);
app.use('/community', postRoutes);
app.use('/sos', sosRoutes);
app.use('/boats', boatRoutes);
app.use('/weather', weatherRoutes);
app.use('/marine', marineRoutes);
app.get('/fail/:kind', (req, res, next) => {
  const error = new Error('private database or credential detail');
  if (req.params.kind === 'cast') error.name = 'CastError';
  if (req.params.kind === 'duplicate') error.code = 11000;
  if (req.params.kind === 'version') error.name = 'VersionError';
  next(error);
});
app.use((req, res, next) => next(new AppError('Route not found', 404)));
app.use(errorHandler);
const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
const token = jwt.sign({ userId: id(1), purpose: 'access', authVersion: 0 }, process.env.JWT_SECRET_KEY);
async function request(path, body, method = body === undefined ? 'GET' : 'PUT') {
  const response = await fetch(base + path, { method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(body !== undefined && { body: JSON.stringify(body) }) });
  return { status: response.status, body: await response.json() };
}
after(async () => { await new Promise(resolve => server.close(resolve)); undo.reverse().forEach(restore => restore()); });

test('own profile has the same fields after update and reload; optional boat ID can be cleared', async () => {
  const initial = await request('/users/profile');
  assert.equal(initial.body.data.user.contact, alice.contact);
  assert.equal(initial.body.data.user.language, 'Tamil');
  const updated = await request('/users/update-profile', { firstName: ' Updated ', boatId: '' });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.data.user.firstName, 'Updated');
  assert.equal(updated.body.data.user.boatId, '');
  assert.deepEqual((await request('/users/profile')).body.data.user, updated.body.data.user);
  for (const key of ['password', 'verificationCodeHash', 'authVersion', '__v']) assert.ok(!(key in updated.body.data.user));
});

test('profile rejects read-only fields, empty required fields, unsupported language and operator objects', async () => {
  for (const body of [{ email: 'new@example.com' }, { isActive: false }, { contact: '' }, { firstName: { $ne: null } },
    { language: 'English' }, {}, [], { firstName: 'x'.repeat(101) }]) {
    const result = await request('/users/update-profile', body);
    assert.equal(result.status, 400);
    assert.equal(result.body.code, 'VALIDATION_ERROR');
  }
});

test('directory pages expose only active peers and public fields with no gaps or duplicates', async () => {
  const first = await request('/users/users?limit=2');
  assert.equal(first.status, 200);
  assert.deepEqual(first.body.data.map(user => user.userId), [id(6), id(5)]);
  assert.equal(lastQuery.projection.includes('email'), false);
  for (const user of first.body.data) assert.deepEqual(Object.keys(user).sort(), ['firstName', 'lastName', 'userId', 'username']);
  const second = await request(`/users/users?limit=2&before=${first.body.pagination.nextCursor}`);
  assert.deepEqual(second.body.data.map(user => user.userId), [id(3), id(2)]);
  assert.equal(second.body.pagination.hasMore, false);
  assert.equal(second.body.pagination.nextCursor, null);
});

test('message history preserves participant filtering, stable pages and bounded reads', async () => {
  const path = `/messages/get?user1=${id(1)}&user2=${id(2)}&limit=2`;
  const first = await request(path);
  assert.deepEqual(first.body.data.map(message => message.id), [id(14), id(13)]);
  assert.equal(lastQuery.maximum, 3);
  const second = await request(`${path}&before=${first.body.pagination.nextCursor}`);
  assert.deepEqual(second.body.data.map(message => message.id), [id(12), id(11)]);
  const third = await request(`${path}&before=${second.body.pagination.nextCursor}`);
  assert.deepEqual(third.body.data.map(message => message.id), [id(10)]);
  assert.equal(third.body.pagination.hasMore, false);
  assert.equal((await request(`/messages/get?user1=${id(2)}&user2=${id(3)}`)).status, 403);
});

test('posts, embedded comments and own SOS lists have bounded, traversable pages', async () => {
  const posts = await request('/community/posts?limit=2');
  assert.equal(posts.body.data.length, 2);
  assert.deepEqual(posts.body.data[0].comments, []);
  assert.equal(lastQuery.projection, '-comments');
  const first = await request(`/community/posts/${id(30)}/comments?limit=2`);
  assert.deepEqual(first.body.data.map(comment => comment.id), [id(23), id(22)]);
  const second = await request(`/community/posts/${id(30)}/comments?limit=2&before=${first.body.pagination.nextCursor}`);
  assert.deepEqual(second.body.data.map(comment => comment.id), [id(21), id(20)]);
  assert.equal(second.body.pagination.hasMore, false);
  assert.equal((await request(`/community/posts/${id(99)}/comments`)).status, 404);
  const own = await request('/sos/active?limit=2');
  assert.deepEqual(own.body.data.map(alert => alert._id), [id(42), id(41)]);
  assert.equal(own.body.pagination.hasMore, true);
});

test('malformed cursors, limits, IDs and oversized request fields are rejected', async () => {
  for (const suffix of ['limit=0', 'limit=51', 'limit=2.5', 'limit=1&limit=2', 'before=bad', 'before[$ne]=x']) {
    const response = await request(`/users/users?${suffix}`);
    assert.equal(response.status, 400, suffix);
    assert.equal(response.body.code, 'VALIDATION_ERROR');
  }
  for (const path of ['/messages/get?user1=x&user2=y', '/messages/get?user1[$ne]=x&user2=y',
    '/community/posts/bad/comments', '/boats/user/bad', '/weather/weather?city=x&city=y',
    '/marine/risk-prediction?latitude=bad&longitude=1', '/marine/risk-prediction?latitude=91&longitude=1']) {
    assert.equal((await request(path)).status, 400, path);
  }
  for (const body of [{ receiverId: {}, message: 'hello' }, { receiverId: id(2), message: 'x'.repeat(4001) }]) {
    assert.equal((await request('/messages/send', body, 'POST')).status, 400);
  }
  assert.equal((await request('/messages/mark-read', { messageIds: ['bad'] }, 'POST')).status, 400);
  assert.equal((await request('/messages/mark-read', { messageIds: Array(101).fill(id(10)) }, 'POST')).status, 400);
});

test('all errors use stable codes and hide internal details and malformed JSON', async () => {
  for (const [path, status, code] of [['/missing', 404, 'NOT_FOUND'], ['/fail/internal', 500, 'INTERNAL_ERROR'],
    ['/fail/cast', 400, 'VALIDATION_ERROR'], ['/fail/duplicate', 409, 'CONFLICT'], ['/fail/version', 409, 'CONFLICT']]) {
    const result = await request(path);
    assert.equal(result.status, status);
    assert.equal(result.body.code, code);
    assert.equal(result.body.success, false);
    assert.ok(!JSON.stringify(result.body).includes('private'));
    assert.equal(result.body.error, undefined);
  }
  const malformed = await fetch(base + '/users/update-profile', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{' });
  assert.equal(malformed.status, 400);
  assert.equal((await malformed.json()).code, 'VALIDATION_ERROR');
  const large = await request('/users/update-profile', { firstName: 'x'.repeat(110_000) });
  assert.equal(large.status, 413);
  assert.equal(large.body.code, 'PAYLOAD_TOO_LARGE');
});

test('upstream authentication errors never masquerade as an expired app session', async () => {
  const { default: axios } = await import('axios');
  const get = axios.get;
  axios.get = async () => { throw { response: { status: 401, data: { message: 'private provider configuration' } } }; };
  try {
    for (const path of ['/weather/weather?city=Colombo', '/marine/risk-prediction?latitude=0&longitude=0']) {
      const response = await request(path);
      assert.equal(response.status, 502);
      assert.equal(response.body.code, 'UPSTREAM_ERROR');
      assert.ok(!response.body.message.includes('private'));
    }
  } finally { axios.get = get; }
});
