import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';

process.env.JWT_SECRET_KEY = 'test-only-signing-key';
test(
  'real MongoDB: racing message retries, legacy rows, unique index and recipient-only receipts',
  { skip: !process.env.MESSAGING_TEST_MONGODB_URI },
  async () => {
    const database = `oceanpulse_messaging_test_${Date.now()}_${process.pid}`;
    const connection = await mongoose
      .createConnection(process.env.MESSAGING_TEST_MONGODB_URI, {
        dbName: database,
        serverSelectionTimeoutMS: 5000,
      })
      .asPromise();
    const undo = [];
    try {
      const [{ default: Message }, { default: User }, { default: controller }] =
        await Promise.all([
          import('../model/MessageSchema.js'),
          import('../model/UserSchema.js'),
          import('../controller/MessageController.js'),
        ]);
      const TestMessage = connection.model('MessagingTest', Message.schema);
      await TestMessage.init();
      await TestMessage.createIndexes();
      for (const method of ['find', 'findOne', 'updateMany', 'aggregate']) {
        const old = Message[method];
        Message[method] = TestMessage[method].bind(TestMessage);
        undo.push(() => {
          Message[method] = old;
        });
      }
      const oldSave = Message.prototype.save;
      Message.prototype.save = async function (options) {
        await new TestMessage(this.toObject()).save(options);
        return this;
      };
      undo.push(() => {
        Message.prototype.save = oldSave;
      });
      const oldUser = User.findById;
      User.findById = (id) => ({
        select: async () => ({ _id: id, isActive: true }),
      });
      undo.push(() => {
        User.findById = oldUser;
      });
      const alice = '000000000000000000000001',
        bob = '000000000000000000000002',
        third = '000000000000000000000003';
      const invoke = async (handler, actor, body) => {
        let data, status;
        await handler(
          { user: { userId: actor }, body },
          {
            status(value) {
              status = value;
              return this;
            },
            json(value) {
              data = value;
            },
          },
          (error) => {
            throw error;
          },
        );
        return { data: data.data, status };
      };
      // The partial unique index must tolerate multiple legacy messages without a retry key.
      await TestMessage.create([
        { senderId: alice, receiverId: bob, message: 'legacy one' },
        { senderId: alice, receiverId: bob, message: 'legacy two' },
      ]);
      const body = {
        receiverId: bob,
        message: 'racing retry',
        clientMessageId: '10000000-0000-4000-8000-000000000001',
      };
      const sends = await Promise.all(
        Array.from({ length: 20 }, () =>
          invoke(controller.sendMessage, alice, body),
        ),
      );
      assert.equal(new Set(sends.map((result) => result.data.id)).size, 1);
      assert.equal(sends.filter((result) => result.status === 201).length, 1);
      assert.equal(await TestMessage.countDocuments(), 3);
      const readBody = { messageIds: [sends[0].data.id] };
      assert.deepEqual(
        (await invoke(controller.markMessagesAsRead, third, readBody)).data
          .receipts,
        [],
      );
      const first = await invoke(controller.markMessagesAsRead, bob, readBody);
      const again = await invoke(controller.markMessagesAsRead, bob, readBody);
      assert.equal(
        first.data.receipts[0].readAt,
        again.data.receipts[0].readAt,
      );
      assert.equal(again.data.modifiedCount, 0);
      assert.equal(
        (await invoke(controller.getReceipts, alice, readBody)).data[0].read,
        true,
      );
      assert.deepEqual(
        (await invoke(controller.getReceipts, third, readBody)).data,
        [],
      );
      const counts = await invoke(controller.getUnreadCounts, bob, {
        senderIds: [alice],
      });
      assert.deepEqual(counts.data, [{ senderId: alice, count: 2 }]);
    } finally {
      undo.reverse().forEach((restore) => restore());
      try {
        await connection.dropDatabase(); // Only the uniquely named test database created above.
      } finally {
        await connection.close();
      }
    }
  },
);
