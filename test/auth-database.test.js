import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';

// Explicit opt-in only; never use the application's configured database.
test('real MongoDB: atomic counters and concurrent account writes', { skip: !process.env.AUTH_TEST_MONGODB_URI }, async () => {
  const database = `oceanpulse_auth_test_${Date.now()}_${process.pid}`;
  const connection = await mongoose.createConnection(process.env.AUTH_TEST_MONGODB_URI, {
    dbName: database, serverSelectionTimeoutMS: 5000,
  }).asPromise();
  try {
    const { default: User } = await import('../model/UserSchema.js');
    const { default: Counter } = await import('../model/AuthRateLimitSchema.js');
    const TestUser = connection.model('AuthTestUser', User.schema);
    const TestCounter = connection.model('AuthTestCounter', Counter.schema);
    await TestCounter.init();
    const counts = await Promise.all(Array.from({ length: 25 }, async () => {
      try {
        return await TestCounter.findOneAndUpdate({ _id: 'same-window' }, {
          $inc: { count: 1 }, $setOnInsert: { expiresAt: new Date(Date.now() + 60_000) },
        }, { upsert: true, new: true });
      } catch (error) {
        if (error.code !== 11000) throw error;
        return TestCounter.findOneAndUpdate({ _id: 'same-window' }, { $inc: { count: 1 } }, { new: true });
      }
    }));
    assert.equal(new Set(counts.map((counter) => counter.count)).size, 25);
    assert.equal((await TestCounter.findById('same-window')).count, 25);
    const saved = await TestUser.create({ username: 'concurrency', firstName: 'Test', lastName: 'User',
      email: 'test@example.com', contact: 'test', password: 'test-hash', isActive: true });
    const [first, second] = await Promise.all([TestUser.findById(saved._id), TestUser.findById(saved._id)]);
    first.authVersion = 1;
    second.authVersion = 1;
    await first.save();
    await assert.rejects(second.save(), { name: 'VersionError' });
  } finally {
    // Only the uniquely named test database created above is removed.
    await connection.dropDatabase();
    await connection.close();
  }
});
