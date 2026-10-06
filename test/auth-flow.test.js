import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

process.env.JWT_SECRET_KEY = 'test-only-signing-key';
process.env.WEATHER_API_KEY = 'test-only-weather-key';
process.env.SENDGRID_API_KEY = 'test-only-sendgrid-key';
process.env.SENDGRID_FROM_EMAIL = 'test@example.com';

const [{ default: User }, { default: sgMail }, { default: userRoute }, { errorHandler }, verification] = await Promise.all([
  import('../model/UserSchema.js'), import('@sendgrid/mail'),
  import('../routes/UserRoute.js'), import('../middleware/errorHandler.js'), import('../utils/verification.js'),
]);

const originals = {
  findOne: User.findOne,
  findById: User.findById,
  save: User.prototype.save,
  send: sgMail.send,
  setApiKey: sgMail.setApiKey,
};
const users = new Map();
const emails = [];

User.findOne = async (query) => [...users.values()].find((user) =>
  Object.entries(query).every(([key, value]) => user[key] === value)) || null;
User.findById = (id) => {
  const user = [...users.values()].find((item) => item._id.toString() === String(id)) || null;
  return {
    select: async () => user,
    then: (resolve, reject) => Promise.resolve(user).then(resolve, reject),
  };
};
User.prototype.save = async function () { users.set(this.email, this); return this; };
sgMail.setApiKey = () => {};
sgMail.send = async (message) => { emails.push(message); return [{ statusCode: 202 }]; };

const app = express();
app.use(express.json());
app.use('/users', userRoute);
app.use(errorHandler);
const server = app.listen(0);
const baseUrl = `http://127.0.0.1:${server.address().port}`;

const request = async (path, { method = 'GET', body, token } = {}) => {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { ...(body && { 'Content-Type': 'application/json' }), ...(token && { Authorization: `Bearer ${token}` }) },
    ...(body && { body: JSON.stringify(body) }),
  });
  return { status: response.status, body: await response.json() };
};

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  User.findOne = originals.findOne;
  User.findById = originals.findById;
  User.prototype.save = originals.save;
  sgMail.send = originals.send;
  sgMail.setApiKey = originals.setApiKey;
});

test('verification and reset codes are emailed, limited, and invalidate old sessions', async () => {
  const identity = { firstName: 'Test', lastName: 'Fisher', email: 'fisher@example.com', contact: '+94771234567', password: 'Password123' };
  const registered = await request('/users/register', { method: 'POST', body: identity });
  assert.equal(registered.status, 201);
  assert.equal(registered.body.data.token, undefined);
  assert.equal(registered.body.data.otp, undefined);
  assert.equal(emails.length, 1);
  const accountCode = /code is (\d{6})/.exec(emails[0].text)?.[1];
  assert.ok(accountCode);
  const user = users.get(identity.email);
  assert.notEqual(user.verificationCodeHash, accountCode);
  assert.equal(user.otp, undefined);

  const inactiveLogin = await request('/users/login', { method: 'POST', body: { email: identity.email, password: identity.password } });
  assert.equal(inactiveLogin.status, 200);
  assert.equal(inactiveLogin.body.data.requiresVerification, true);
  assert.equal(inactiveLogin.body.data.token, undefined);
  assert.equal((await request('/users/resend-verification-otp', { method: 'POST', body: { username: user.username, email: user.email } })).status, 429);
  assert.equal((await request('/users/verify-otp', { method: 'POST', body: { username: user.username, otp: '000000' } })).status, 400);
  assert.equal(user.verificationAttempts, 1);

  const verified = await request('/users/verify-otp', { method: 'POST', body: { username: user.username, otp: accountCode } });
  assert.equal(verified.status, 200);
  const oldAccessToken = verified.body.data.token;
  assert.equal((await request('/users/profile', { token: oldAccessToken })).status, 200);

  const forgot = await request('/users/forgot-password', { method: 'POST', body: { email: user.email } });
  assert.equal(forgot.status, 200);
  assert.equal(forgot.body.data.otp, undefined);
  assert.equal((await request('/users/forgot-password', { method: 'POST', body: { email: 'missing@example.com' } })).status, 200);
  assert.equal(emails.length, 2);
  const resetCode = /code is (\d{6})/.exec(emails[1].text)?.[1];
  assert.ok(resetCode);
  const resetVerified = await request('/users/verify-reset-otp', { method: 'POST', body: { email: user.email, otp: resetCode } });
  assert.equal(resetVerified.status, 200);
  const resetToken = resetVerified.body.data.resetToken;
  assert.equal((await request('/users/profile', { token: resetToken })).status, 401);

  const reset = await request('/users/reset-password', { method: 'POST', body: { email: user.email, password: 'NewPassword123', resetToken } });
  assert.equal(reset.status, 200);
  assert.equal((await request('/users/profile', { token: oldAccessToken })).status, 401);
  assert.equal((await request('/users/reset-password', { method: 'POST', body: { email: user.email, password: 'AnotherPassword123', resetToken } })).status, 401);
  assert.equal((await request('/users/login', { method: 'POST', body: { email: user.email, password: identity.password } })).status, 401);
  assert.equal((await request('/users/login', { method: 'POST', body: { email: user.email, password: 'NewPassword123' } })).status, 200);
});

test('five wrong codes lock the current code window, including resends', async () => {
  const user = { _id: '507f1f77bcf86cd799439014', save: async () => {} };
  const code = verification.issueVerification(user, 'account');
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await assert.rejects(verification.verifyCode(user, 'account', '000000'), { statusCode: 400 });
  }
  user.verificationSentAt = new Date(Date.now() - 61_000);
  assert.throws(() => verification.issueVerification(user, 'account'), { statusCode: 429 });
  await assert.rejects(verification.verifyCode(user, 'account', code), { statusCode: 400 });
});
