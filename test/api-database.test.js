import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';

process.env.JWT_SECRET_KEY = 'test-only-signing-key';
process.env.WEATHER_API_KEY = 'test-only-weather-key';

test('real MongoDB: list queries and embedded-comment aggregation traverse bounded pages', { skip: !process.env.API_TEST_MONGODB_URI }, async () => {
  const database = `oceanpulse_api_test_${Date.now()}_${process.pid}`;
  const connection = await mongoose.createConnection(process.env.API_TEST_MONGODB_URI, {
    dbName: database, serverSelectionTimeoutMS: 5000,
  }).asPromise();
  const undo = [];
  try {
    const [{ default: Message }, { default: Post }, { default: User }, { default: messageController },
      { default: postController }, { default: userController }] = await Promise.all([
      import('../model/MessageSchema.js'), import('../model/CommunityAlertSchema.js'), import('../model/UserSchema.js'),
      import('../controller/MessageController.js'), import('../controller/CommunityAlertController.js'), import('../controller/UserController.js'),
    ]);
    const TestMessage = connection.model('PagingMessage', Message.schema);
    const TestPost = connection.model('PagingPost', Post.schema);
    const TestUser = connection.model('PagingUser', User.schema);
    for (const [source, replacement, method] of [[Message, TestMessage, 'find'], [Post, TestPost, 'find'],
      [Post, TestPost, 'aggregate'], [User, TestUser, 'find']]) {
      const original = source[method];
      source[method] = replacement[method].bind(replacement);
      undo.push(() => { source[method] = original; });
    }
    const id = n => n.toString(16).padStart(24, '0');
    const request = query => ({ query, user: { userId: id(1), username: 'alice' }, params: {} });
    const invoke = async (handler, req) => {
      let result;
      const res = { status() { return this; }, json(body) { result = body; } };
      await handler(req, res, error => { throw error; });
      return result;
    };
    await TestMessage.create([10, 11, 12].map(n => ({ _id: id(n), senderId: id(1), receiverId: id(2), message: String(n) })));
    const first = await invoke(messageController.getMessages, request({ user1: id(1), user2: id(2), limit: '2' }));
    assert.deepEqual(first.data.map(message => message.id), [id(12), id(11)]);
    const second = await invoke(messageController.getMessages, request({ user1: id(1), user2: id(2), limit: '2', before: first.pagination.nextCursor }));
    assert.deepEqual(second.data.map(message => message.id), [id(10)]);
    assert.equal(second.pagination.hasMore, false);
    // Deliberately store comments out of ID order to verify aggregation ordering.
    await TestPost.create({ _id: id(30), content: 'post', comments: [22, 20, 21].map(n => ({ _id: id(n), content: String(n) })) });
    const commentsReq = request({ limit: '2' });
    commentsReq.params.postId = id(30);
    const comments = await invoke(postController.getComments, commentsReq);
    assert.deepEqual(comments.data.map(comment => comment.id), [id(22), id(21)]);
    commentsReq.query.before = comments.pagination.nextCursor;
    const older = await invoke(postController.getComments, commentsReq);
    assert.deepEqual(older.data.map(comment => comment.id), [id(20)]);
    const feed = await invoke(postController.getAllPosts, request({ limit: '2' }));
    assert.deepEqual(feed.data[0].comments, []);
    await TestUser.create([1, 2, 3].map(n => ({ _id: id(n), username: `user${n}`, firstName: 'Test', lastName: 'User',
      email: `${n}@example.com`, contact: 'private', password: 'private', isActive: n !== 3 })));
    const directory = await invoke(userController.fetchUsers, request({ limit: '2' }));
    assert.deepEqual(directory.data.map(user => user.userId), [id(2)]);
    assert.equal(directory.data[0].email, undefined);
  } finally {
    undo.reverse().forEach(restore => restore());
    await connection.dropDatabase(); // Only the unique test database created above.
    await connection.close();
  }
});
