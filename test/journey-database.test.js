import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import sgMail from '@sendgrid/mail';
import { mobileClient } from '../test-support/mobile-client.js';

const uri = process.env.JOURNEY_TEST_MONGODB_URI;

test(
  'real MongoDB and API: account, mobile profile/SOS/chat, reconnect, restart and reset journeys',
  {
    skip: !uri,
    timeout: 90000,
  },
  async (t) => {
    // Only the external email transport is replaced. Database, auth, middleware,
    // controllers, HTTP, WebSockets, startup gates and checked-in mobile logic are real.
    process.env.JWT_SECRET_KEY = 'isolated-journey-test-signing-key';
    process.env.SENDGRID_API_KEY = 'SG.isolated-test.not-a-delivery-key';
    process.env.SENDGRID_FROM_EMAIL = 'noreply@example.test';
    const mail = new Map();
    const originalSend = sgMail.send;
    sgMail.send = async (message) => {
      const code = /\b\d{6}\b/.exec(message.text)?.[0];
      assert.ok(code, 'the application must generate an emailed code');
      mail.set(message.to, code);
      return [{ statusCode: 202 }];
    };

    const database = `oceanpulse_journey_test_${Date.now()}_${randomUUID().replaceAll('-', '').slice(0, 8)}`;
    let runtime;
    const hooks = new Set();
    const clients = new Set();
    const actors = {};
    let base;
    let alice;
    let bob;
    let savedProfile;
    let sosReceipt;
    let savedMessageId;
    const password = 'IntegrationPass123';
    const apiRequest = async (path, { method = 'GET', body, token } = {}) => {
      const response = await fetch(base + path, {
        method,
        signal: AbortSignal.timeout(10000),
        headers: {
          'Content-Type': 'application/json',
          ...(token && { Authorization: `Bearer ${token}` }),
        },
        ...(body && { body: JSON.stringify(body) }),
      });
      return { status: response.status, body: await response.json() };
    };
    const waitFor = async (hook, predicate, label) => {
      const deadline = Date.now() + 8000;
      while (!predicate()) {
        if (Date.now() > deadline)
          throw new Error(
            `Timed out: ${label}; ${JSON.stringify({
              status: hook.value.status,
              count: hook.value.messages?.length,
              loading: hook.value.loading,
              hasMore: hook.value.hasMore,
            })}`,
          );
        await hook.act(async () => {
          await new Promise((resolve) => setTimeout(resolve, 20));
        });
      }
    };

    try {
      const [
        { startServer },
        { default: User },
        { default: Message },
        { default: Sos },
        { default: Counter },
      ] = await Promise.all([
        import('../app.js'),
        import('../model/UserSchema.js'),
        import('../model/MessageSchema.js'),
        import('../model/SosAlertSchema.js'),
        import('../model/AuthRateLimitSchema.js'),
      ]);
      runtime = await startServer({
        mongoUri: uri,
        dbName: database,
        port: 0,
        host: '127.0.0.1',
      });
      base = `http://127.0.0.1:${runtime.server.address().port}/api/v1/`;
      await Promise.all(
        Object.values(mongoose.models).map((model) => model.init()),
      );

      await t.test(
        'production startup gates build actual message, SOS and auth indexes',
        async () => {
          const messageIndexes = await Message.collection.indexes();
          assert.ok(
            messageIndexes.some(
              (index) =>
                index.name === 'message_sender_retry_key' && index.unique,
            ),
          );
          const sosIndexes = await Sos.collection.indexes();
          assert.ok(
            sosIndexes.some(
              (index) =>
                index.name === 'one_active_sos_per_user' && index.unique,
            ),
          );
          const counterIndexes = await Counter.collection.indexes();
          assert.ok(
            counterIndexes.some((index) => index.expireAfterSeconds === 0),
          );
          assert.equal((await apiRequest('test')).status, 200);
          assert.equal(mongoose.connection.name, database);
        },
      );

      await t.test(
        'registration, inactive login, emailed-code activation and login use real persisted accounts',
        async () => {
          for (const [key, name] of [
            ['alice', 'Alice'],
            ['bob', 'Bob'],
            ['charlie', 'Charlie'],
          ]) {
            const email = `${key}@example.test`;
            const registered = await apiRequest('users/register', {
              method: 'POST',
              body: {
                firstName: name,
                lastName: 'Integration',
                email,
                contact: '+94770000000',
                password,
              },
            });
            assert.equal(registered.status, 201);
            assert.equal(registered.body.data.token, undefined);
            assert.equal(registered.body.data.otp, undefined);
            const stored = await User.findById(
              registered.body.data.user.userId,
            ).lean();
            assert.notEqual(stored.password, password);
            assert.equal(stored.isActive, false);
            assert.equal(stored.otp, undefined);
            assert.ok(stored.verificationCodeHash);
            const pending = await apiRequest('users/login', {
              method: 'POST',
              body: { email, password },
            });
            assert.equal(pending.body.data.requiresVerification, true);
            assert.equal(pending.body.data.token, undefined);
            const verified = await apiRequest('users/verify-otp', {
              method: 'POST',
              body: {
                username: stored.username,
                otp: mail.get(email),
              },
            });
            assert.equal(verified.status, 200);
            assert.ok(verified.body.data.token);
            const loggedIn = await apiRequest('users/login', {
              method: 'POST',
              body: { email, password },
            });
            assert.equal(loggedIn.status, 200);
            actors[key] = {
              token: loggedIn.body.data.token,
              user: loggedIn.body.data.user,
            };
          }
          assert.equal(await User.countDocuments(), 3);
          assert.ok(
            (await Counter.countDocuments()) > 0,
            'HTTP auth uses actual shared counters',
          );
          alice = mobileClient(base);
          bob = mobileClient(base);
          clients.add(alice);
          clients.add(bob);
          await alice.signIn(actors.alice.token, actors.alice.user);
          await bob.signIn(actors.bob.token, actors.bob.user);
          assert.equal(alice.store.getState().auth.isAuthenticated, true);
          const profile = await alice.api.get('users/profile');
          assert.equal(profile.data.data.user.userId, actors.alice.user.userId);
        },
      );

      await t.test(
        'actual mobile profile hook saves, reloads a fresh instance and rejects a stale editor',
        async () => {
          const first = await alice.mount('utils/useProfile', [
            actors.alice.user.userId,
            true,
          ]);
          hooks.add(first);
          await waitFor(
            first,
            () => first.value.user && !first.value.loading,
            'initial mobile profile',
          );
          first.act(() => first.value.openEditor());
          first.act(() => first.value.change('firstName', 'Saved Alice'));
          first.act(() => first.value.change('boatId', 'BOAT-INTEGRATION'));
          await first.act(async () => first.value.save());
          assert.equal(first.value.notice, 'Profile changes saved.');
          assert.equal(first.value.user.firstName, 'Saved Alice');
          await first.close();
          hooks.delete(first);
          const fresh = await alice.mount('utils/useProfile', [
            actors.alice.user.userId,
            true,
          ]);
          hooks.add(fresh);
          await waitFor(
            fresh,
            () => fresh.value.user && !fresh.value.loading,
            'reopened profile',
          );
          assert.equal(fresh.value.user.boatId, 'BOAT-INTEGRATION');
          fresh.act(() => fresh.value.openEditor());
          fresh.act(() => fresh.value.change('contact', 'stale contact'));
          const loaded = (await alice.api.get('users/profile')).data.data;
          const external = await alice.api.put('users/update-profile', {
            contact: 'other device contact',
            expectedVersion: loaded.profileVersion,
          });
          await fresh.act(async () => fresh.value.save());
          assert.match(fresh.value.error, /changed elsewhere/);
          assert.equal(fresh.value.draft.contact, 'stale contact');
          assert.equal(
            (await User.findById(actors.alice.user.userId)).contact,
            'other device contact',
          );
          await fresh.act(async () => fresh.value.discardAndReload());
          await waitFor(
            fresh,
            () => fresh.value.user?.contact === 'other device contact',
            'profile conflict reload',
          );
          savedProfile = external.data.data.user;
          await fresh.close();
          hooks.delete(fresh);
        },
      );

      await t.test(
        'actual mobile SOS hook records zero coordinates once and recovers the original receipt',
        async () => {
          const sos = await alice.mount('utils/useSosRequest', []);
          hooks.add(sos);
          assert.equal(
            await Sos.countDocuments(),
            0,
            'mount alone does not submit',
          );
          await sos.act(async () => {
            await Promise.all([sos.value.send(), sos.value.send()]);
          });
          assert.equal(sos.value.phase, 'recorded');
          sosReceipt = sos.value.receipt;
          assert.equal(sosReceipt.responderNotified, false);
          assert.equal(sosReceipt.location.latitude, 0);
          assert.equal(
            await Sos.countDocuments({ userId: actors.alice.user.userId }),
            1,
          );
          const retry = await apiRequest('sosAlerts/sos', {
            method: 'POST',
            token: actors.alice.token,
            body: { latitude: 20, longitude: 80 },
          });
          assert.equal(retry.status, 200);
          assert.equal(retry.body.data.id, sosReceipt.id);
          assert.deepEqual(retry.body.data.location, sosReceipt.location);
          const current = await alice.api.get('sosAlerts/current');
          assert.equal(
            current.data.data.receipt.receivedAt,
            sosReceipt.receivedAt,
          );
          const foreign = await bob.api.get('sosAlerts/current');
          assert.equal(foreign.data.data.receipt, null);
          await sos.close();
          hooks.delete(sos);
        },
      );

      await t.test(
        'two actual mobile chat hooks exchange authenticated socket messages and persisted read receipts',
        async () => {
          const a = await alice.mount('utils/useMessages', [
            actors.alice.user.userId,
            actors.bob.user.userId,
            true,
          ]);
          const b = await bob.mount('utils/useMessages', [
            actors.bob.user.userId,
            actors.alice.user.userId,
            true,
          ]);
          hooks.add(a);
          hooks.add(b);
          await waitFor(
            a,
            () =>
              a.value.status === 'Connected' && b.value.status === 'Connected',
            'two authenticated sockets',
          );
          a.act(() => {
            assert.equal(a.value.send('hello from mobile logic'), true);
          });
          await waitFor(
            a,
            () =>
              a.value.messages.some((message) => !message.localStatus) &&
              b.value.messages.length === 1,
            'socket delivery',
          );
          savedMessageId = b.value.messages[0].id;
          assert.equal(
            b.value.messages[0].read,
            false,
            'a socket notification alone is not read',
          );
          await b.act(async () => b.value.markVisible([savedMessageId]));
          await waitFor(
            a,
            () => a.value.messages[0]?.read === true,
            'live sender read receipt',
          );
          const row = await Message.findById(savedMessageId).lean();
          assert.equal(row.read, true);
          assert.ok(row.readAt);

          // Simulate a committed send whose HTTP reply is lost while the socket is unavailable.
          await a.update([
            actors.alice.user.userId,
            actors.bob.user.userId,
            false,
          ]);
          alice.faults.dropNextSendReply = true;
          a.act(() => {
            a.value.send('uncertain mobile send');
          });
          await waitFor(
            a,
            () =>
              a.value.messages.some(
                (message) => message.localStatus === 'failed',
              ),
            'failed send retained',
          );
          const pending = a.value.messages.find(
            (message) => message.localStatus === 'failed',
          );
          const stored = await Message.findOne({
            senderId: actors.alice.user.userId,
            clientMessageId: pending.clientMessageId,
          }).lean();
          assert.ok(stored, 'the lost reply happened after persistence');
          await a.act(async () => {
            await Promise.all([a.value.retry(pending), a.value.retry(pending)]);
          });
          assert.equal(
            await Message.countDocuments({
              senderId: actors.alice.user.userId,
              clientMessageId: pending.clientMessageId,
            }),
            1,
          );
          assert.equal(
            a.value.messages.filter(
              (message) => message.clientMessageId === pending.clientMessageId,
            ).length,
            1,
          );

          // Miss more than two history pages, then reconnect through the real client catch-up path.
          await b.update([
            actors.bob.user.userId,
            actors.alice.user.userId,
            false,
          ]);
          const missed = await Promise.all(
            Array.from({ length: 55 }, (_, index) =>
              apiRequest('messages/send', {
                method: 'POST',
                token: actors.alice.token,
                body: {
                  receiverId: actors.bob.user.userId,
                  message: `missed ${index}`,
                  clientMessageId: randomUUID(),
                },
              }),
            ),
          );
          assert.ok(missed.every((result) => result.status === 201));
          await b.update([
            actors.bob.user.userId,
            actors.alice.user.userId,
            true,
          ]);
          await waitFor(
            b,
            () =>
              b.value.status === 'Connected' && b.value.messages.length === 57,
            'multi-page reconnect recovery',
          );
          assert.equal(
            new Set(b.value.messages.map((message) => message.id)).size,
            57,
          );
          const unread = await bob.api.post('messages/unread', {
            senderIds: [actors.alice.user.userId],
          });
          assert.equal(unread.data.data[0].count, 56);
          const foreign = await apiRequest(
            `messages/get?user1=${actors.alice.user.userId}&user2=${actors.bob.user.userId}`,
            {
              token: actors.charlie.token,
            },
          );
          assert.equal(foreign.status, 403);
          await a.close();
          hooks.delete(a);
          await b.close();
          hooks.delete(b);
        },
      );

      await t.test(
        'API restart keeps profile, SOS receipt, messages and read timestamps in MongoDB',
        async () => {
          const port = runtime.server.address().port;
          const readAt = (
            await Message.findById(savedMessageId).lean()
          ).readAt.getTime();
          await runtime.close();
          runtime = await startServer({
            mongoUri: uri,
            dbName: database,
            port,
            host: '127.0.0.1',
          });
          const profile = await alice.api.get('users/profile');
          assert.equal(
            profile.data.data.user.firstName,
            savedProfile.firstName,
          );
          assert.equal(profile.data.data.user.contact, savedProfile.contact);
          const current = await alice.api.get('sosAlerts/current');
          assert.equal(current.data.data.receipt.id, sosReceipt.id);
          assert.equal(await Message.countDocuments(), 57);
          assert.equal(
            (await Message.findById(savedMessageId).lean()).readAt.getTime(),
            readAt,
          );
          const history = await bob.api.get('messages/get', {
            params: {
              user1: actors.bob.user.userId,
              user2: actors.alice.user.userId,
            },
          });
          assert.equal(history.data.data.length, 25);
          assert.equal(history.data.pagination.hasMore, true);
        },
      );

      await t.test(
        'password reset revokes live sockets and REST tokens; mobile 401 handling clears the session',
        async () => {
          const chat = await alice.mount('utils/useMessages', [
            actors.alice.user.userId,
            actors.bob.user.userId,
            true,
          ]);
          hooks.add(chat);
          await waitFor(
            chat,
            () => chat.value.status === 'Connected',
            'socket before password reset',
          );
          const email = actors.alice.user.email;
          const forgot = await apiRequest('users/forgot-password', {
            method: 'POST',
            body: { email },
          });
          assert.equal(forgot.status, 200);
          const verified = await apiRequest('users/verify-reset-otp', {
            method: 'POST',
            body: { email, otp: mail.get(email) },
          });
          assert.equal(verified.status, 200);
          const resetToken = verified.body.data.resetToken;
          const reset = await apiRequest('users/reset-password', {
            method: 'POST',
            body: {
              email,
              password: 'NewIntegrationPass123',
              resetToken,
            },
          });
          assert.equal(reset.status, 200);
          const trigger = await bob.api.post('messages/send', {
            receiverId: actors.alice.user.userId,
            message: 'after reset',
            clientMessageId: randomUUID(),
          });
          await waitFor(
            chat,
            () => chat.value.status !== 'Connected',
            'revoked socket closed before new content',
          );
          assert.equal(
            chat.value.messages.some(
              (message) => message.id === trigger.data.data.id,
            ),
            false,
          );
          await assert.rejects(
            alice.api.get('users/profile'),
            (error) => error.response?.status === 401,
          );
          assert.equal(await alice.session.getToken(), null);
          assert.equal(alice.store.getState().auth.isAuthenticated, false);
          assert.equal(
            (
              await apiRequest('users/login', {
                method: 'POST',
                body: { email, password },
              })
            ).status,
            401,
          );
          assert.equal(
            (
              await apiRequest('users/login', {
                method: 'POST',
                body: { email, password: 'NewIntegrationPass123' },
              })
            ).status,
            200,
          );
          assert.equal(
            (
              await apiRequest('users/reset-password', {
                method: 'POST',
                body: {
                  email,
                  password: 'AnotherIntegration123',
                  resetToken,
                },
              })
            ).status,
            401,
          );
          await chat.close();
          hooks.delete(chat);
        },
      );
    } finally {
      for (const hook of hooks) await hook.close();
      for (const client of clients) client.close();
      try {
        if (runtime) await runtime.close();
      } finally {
        sgMail.send = originalSend;
        const cleanup = mongoose.createConnection(uri, {
          dbName: database,
          serverSelectionTimeoutMS: 5000,
        });
        try {
          await cleanup.asPromise();
          assert.equal(cleanup.name, database);
          assert.match(database, /^oceanpulse_journey_test_\d+_[a-f0-9]{8}$/);
          await cleanup.dropDatabase();
        } finally {
          await cleanup.close();
        }
      }
    }
  },
);
