import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import jwt from 'jsonwebtoken';

process.env.JWT_SECRET_KEY = 'test-only-signing-key';
process.env.WEATHER_API_KEY = 'test-only-weather-key';

const [{ default: User }, { default: Message }, { default: BoatLocation },
  { default: CommunityAlert }, { default: SosAlert },
  { default: messageRoute }, { default: boatRoute },
  { default: communityRoute }, { default: sosRoute },
  { errorHandler }] = await Promise.all([
  import('../model/UserSchema.js'), import('../model/MessageSchema.js'),
  import('../model/BoatLocationSchema.js'), import('../model/CommunityAlertSchema.js'),
  import('../model/SosAlertSchema.js'), import('../routes/MessageRoute.js'),
  import('../routes/BoatLocationRoute.js'), import('../routes/CommunityAlertRoute.js'),
  import('../routes/SosAlertRoute.js'), import('../middleware/errorHandler.js'),
]);

const alice = '507f1f77bcf86cd799439011';
const bob = '507f1f77bcf86cd799439012';
const inactive = '507f1f77bcf86cd799439013';
const token = (id) => jwt.sign({ userId: id, username: 'untrusted-token-name' }, process.env.JWT_SECRET_KEY);

const originals = {
  findUser: User.findById,
  saveMessage: Message.prototype.save,
  findMessages: Message.find,
  updateMessages: Message.updateMany,
  updateLocation: BoatLocation.findOneAndUpdate,
  findLocation: BoatLocation.findOne,
  savePost: CommunityAlert.prototype.save,
  findPost: CommunityAlert.findById,
  findSos: SosAlert.findOne,
  saveSos: SosAlert.prototype.save,
  listSos: SosAlert.find,
};

let savedMessage;
let messageQuery;
let readQuery;
let locationQuery;
let savedPost;
let savedSos;
let sosQuery;

User.findById = (id) => ({
  select: async () => id === inactive ? { _id: id, username: 'inactive', isActive: false }
    : id === alice || id === bob ? { _id: id, username: id === alice ? 'alice' : 'bob', isActive: true }
      : null,
});
Message.prototype.save = async function () { savedMessage = this; return this; };
Message.find = (query) => { messageQuery = query; return { sort: () => ({ lean: async () => [] }) }; };
Message.updateMany = async (query) => { readQuery = query; return { modifiedCount: 1 }; };
BoatLocation.findOneAndUpdate = async (query, update) => { locationQuery = { query, update }; return update; };
BoatLocation.findOne = async ({ userId }) => ({ userId, location: { coordinates: [0, 0] } });
CommunityAlert.prototype.save = async function () { savedPost = this; return this; };
CommunityAlert.findById = async () => ({ comments: [], save: async function () { return this; } });
SosAlert.findOne = async () => null;
SosAlert.prototype.save = async function () { savedSos = this; return this; };
SosAlert.find = (query) => { sosQuery = query; return { sort: async () => [] }; };

const app = express();
app.use(express.json());
app.use('/messages', messageRoute);
app.use('/boatLocations', boatRoute);
app.use('/communityAlerts', communityRoute);
app.use('/sosAlerts', sosRoute);
app.use(errorHandler);
const server = app.listen(0);
const baseUrl = `http://127.0.0.1:${server.address().port}`;

const request = async (path, { method = 'GET', actor = alice, body } = {}) => {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { ...(actor && { Authorization: `Bearer ${token(actor)}` }), ...(body && { 'Content-Type': 'application/json' }) },
    ...(body && { body: JSON.stringify(body) }),
  });
  return { status: response.status, body: await response.json() };
};

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  User.findById = originals.findUser;
  Message.prototype.save = originals.saveMessage;
  Message.find = originals.findMessages;
  Message.updateMany = originals.updateMessages;
  BoatLocation.findOneAndUpdate = originals.updateLocation;
  BoatLocation.findOne = originals.findLocation;
  CommunityAlert.prototype.save = originals.savePost;
  CommunityAlert.findById = originals.findPost;
  SosAlert.findOne = originals.findSos;
  SosAlert.prototype.save = originals.saveSos;
  SosAlert.find = originals.listSos;
});

test('protected routes reject missing and inactive sessions', async () => {
  assert.equal((await request('/messages/get?user1=' + alice + '&user2=' + bob, { actor: null })).status, 401);
  assert.equal((await request('/messages/get?user1=' + inactive + '&user2=' + bob, { actor: inactive })).status, 401);
  assert.equal((await request('/messages/get?user1=' + alice + '&user2=' + bob, { actor: 'malformed' })).status, 401);
});

test('messages use the authenticated sender and allow only participants to read', async () => {
  assert.equal((await request('/messages/send', { method: 'POST', body: { senderId: bob, receiverId: bob, message: 'hello' } })).status, 403);
  const sent = await request('/messages/send', { method: 'POST', body: { receiverId: bob, message: 'hello' } });
  assert.equal(sent.status, 201);
  assert.equal(savedMessage.senderId, alice);
  assert.equal((await request(`/messages/get?user1=${bob}&user2=${inactive}`)).status, 403);
  assert.equal((await request(`/messages/get?user1=${alice}&user2=${bob}`)).status, 200);
  assert.equal(messageQuery.$or[0].senderId, alice);
  assert.equal((await request('/messages/mark-read', { method: 'POST', body: { messageIds: ['m1'], userId: bob } })).status, 403);
  assert.equal((await request('/messages/mark-read', { method: 'POST', body: { messageIds: ['m1'] } })).status, 200);
  assert.equal(readQuery.receiverId, alice);
});

test('location writes belong to the actor and zero coordinates are valid', async () => {
  assert.equal((await request('/boatLocations/update', { method: 'POST', body: { userId: bob, latitude: 0, longitude: 0 } })).status, 403);
  assert.equal((await request('/boatLocations/update', { method: 'POST', body: { latitude: 0, longitude: 0 } })).status, 200);
  assert.equal(locationQuery.query.userId, alice);
  assert.deepEqual(locationQuery.update.location.coordinates, [0, 0]);
  assert.equal((await request(`/boatLocations/user/${bob}`)).status, 403);
  assert.equal((await request('/boatLocations/nearby?latitude=0&longitude=0')).status, 403);
});

test('community authors are derived from the account', async () => {
  assert.equal((await request('/communityAlerts/posts', { method: 'POST', body: { content: 'hi', userId: bob, username: 'bob' } })).status, 403);
  assert.equal((await request('/communityAlerts/posts', { method: 'POST', body: { content: 'hi' } })).status, 201);
  assert.equal(savedPost.userId, alice);
  assert.equal(savedPost.username, 'alice');
  assert.equal((await request('/communityAlerts/posts/any/comment', { method: 'POST', body: { content: 'reply', userId: bob, username: 'bob' } })).status, 403);
});

test('SOS records use the actor and responder operations stay closed', async () => {
  assert.equal((await request('/sosAlerts/sos', { method: 'POST', body: { userId: bob, username: 'bob', latitude: 0, longitude: 0 } })).status, 403);
  assert.equal((await request('/sosAlerts/sos', { method: 'POST', body: { latitude: 0, longitude: 0 } })).status, 201);
  assert.equal(savedSos.userId, alice);
  assert.equal((await request('/sosAlerts/active')).status, 200);
  assert.deepEqual(sosQuery, { userId: alice, isHandled: false });
  assert.equal((await request('/sosAlerts/any/status', { method: 'PATCH', body: { isHandled: true } })).status, 403);
});
