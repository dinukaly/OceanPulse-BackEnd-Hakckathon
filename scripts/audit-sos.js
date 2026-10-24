import mongoose from 'mongoose';
import { config } from '../config/env.js';

// Read-only: never create indexes, merge records, change status or delete data.
try {
  await mongoose.connect(config.mongoUri, { autoIndex: false, autoCreate: false, serverSelectionTimeoutMS: 5000 });
  // Use the native collection so importing a model cannot auto-create a collection.
  const collection = mongoose.connection.db.collection('sosalerts');
  const [duplicates, nonCanonical] = await Promise.all([
    collection.aggregate([
      { $match: { isHandled: false } },
      { $group: { _id: '$userId', count: { $sum: 1 } } },
      { $match: { count: { $gt: 1 } } }, { $limit: 100 },
    ], { maxTimeMS: 10000 }).toArray(),
    collection.countDocuments({ isHandled: false, userId: { $not: /^[a-f\d]{24}$/ } }, { maxTimeMS: 10000 }),
  ]);
  console.log(JSON.stringify({ duplicateActiveUsers: duplicates, nonCanonicalActiveUserIds: nonCanonical,
    duplicateReportLimit: 100, readOnly: true }, null, 2));
  if (duplicates.length || nonCanonical) process.exitCode = 1;
} catch {
  console.error('SOS audit could not complete. Check database connectivity and read permissions.');
  process.exitCode = 1;
} finally { await mongoose.disconnect(); }
