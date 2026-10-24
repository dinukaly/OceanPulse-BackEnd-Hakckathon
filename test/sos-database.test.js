import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import Sos from '../model/SosAlertSchema.js';
import Controller from '../controller/SosAlertController.js';

test('real MongoDB: racing SOS upserts, unique active constraint and legacy index failure', { skip: !process.env.SOS_TEST_MONGODB_URI }, async () => {
  const database = `oceanpulse_sos_test_${Date.now()}_${process.pid}`;
  const connection = await mongoose.createConnection(process.env.SOS_TEST_MONGODB_URI,
    { dbName: database, autoIndex: false, serverSelectionTimeoutMS: 5000 }).asPromise();
  const originals = { upsert: Sos.findOneAndUpdate, find: Sos.findOne };
  try {
    const TestSos = connection.model('ReliableSos', Sos.schema);
    await TestSos.createIndexes();
    Sos.findOneAndUpdate = TestSos.findOneAndUpdate.bind(TestSos);
    Sos.findOne = TestSos.findOne.bind(TestSos);
    const userId = '507f1f77bcf86cd799439011';
    const invoke = async latitude => {
      let result;
      const res = { status(code) { this.code = code; return this; }, json(body) { result = { status: this.code, body }; } };
      await Controller.saveSosMessage({ user: { userId, username: 'test' }, body: { latitude, longitude: 0 } }, res, error => { throw error; });
      return result;
    };
    const results = await Promise.all(Array.from({ length: 30 }, (_, n) => invoke(n)));
    assert.equal(await TestSos.countDocuments({ userId, isHandled: false }), 1);
    assert.equal(results.filter(result => result.status === 201).length, 1);
    assert.equal(results.filter(result => result.status === 200).length, 29);
    assert.equal(new Set(results.map(result => result.body.data.id)).size, 1);
    assert.equal(new Set(results.map(result => result.body.data.receivedAt)).size, 1);
    const original = await TestSos.findOne({ userId, isHandled: false }).lean();
    await invoke(80);
    const unchanged = await TestSos.findById(original._id).lean();
    assert.equal(unchanged.latitude, original.latitude);
    assert.equal(unchanged.timestamp.getTime(), original.timestamp.getTime());
    await assert.rejects(TestSos.create({ userId, username: 'test', latitude: 0, longitude: 0, isHandled: false }), { code: 11000 });
    await TestSos.create({ userId, username: 'test', latitude: 0, longitude: 0, isHandled: true });
    assert.equal(await TestSos.countDocuments({ userId }), 2);
    const Legacy = connection.model('LegacySos', Sos.schema);
    await Legacy.collection.insertMany([1, 2].map(() => ({ userId, username: 'test', latitude: 0, longitude: 0, isHandled: false })));
    await assert.rejects(Legacy.createIndexes(), { code: 11000 });
    assert.equal(await Legacy.countDocuments(), 2, 'conflicting legacy records must remain untouched');
  } finally {
    Sos.findOneAndUpdate = originals.upsert;
    Sos.findOne = originals.find;
    await connection.dropDatabase(); // Only this uniquely named disposable test database.
    await connection.close();
  }
});
