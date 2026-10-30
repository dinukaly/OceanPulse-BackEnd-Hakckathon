import mongoose from 'mongoose';

// A fixed-window counter uses the built-in unique _id index for atomic upserts.
const schema = new mongoose.Schema({
  _id: String,
  count: { type: Number, required: true },
  expiresAt: { type: Date, required: true },
});
schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
export default mongoose.model('AuthRateLimit', schema);
