import mongoose from "mongoose";

const messageSchema = new mongoose.Schema({
  senderId: { type: String, required: true },
  receiverId: { type: String, required: true },
  message: { type: String, required: true },
  clientMessageId: { type: String },
  timestamp: { type: Date, default: Date.now },
  read: { type: Boolean, default: false },
  readAt: { type: Date }
}, {
  versionKey: false // Disable the version key (__v)
});

// Indexes
messageSchema.index({ senderId: 1, receiverId: 1, _id: -1 });
messageSchema.index({ timestamp: 1 });
messageSchema.index({ receiverId: 1, read: 1, senderId: 1 });
// Legacy messages without a retry key remain valid and are never deduplicated retroactively.
messageSchema.index({ senderId: 1, clientMessageId: 1 }, {
  name: 'message_sender_retry_key', unique: true,
  partialFilterExpression: { clientMessageId: { $type: 'string' } },
});


export default mongoose.model("Message", messageSchema);
