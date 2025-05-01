import mongoose from "mongoose";

const messageSchema = new mongoose.Schema({
  senderId: { type: String, required: true },
  receiverId: { type: String, required: true },
  message: { type: String, required: true },
  timestamp: { type: Date, default: Date.now },
  read: { type: Boolean, default: false },
  readAt: { type: Date }
}, {
  versionKey: false // Disable the version key (__v)
});

// Indexes
messageSchema.index({ senderId: 1, receiverId: 1 });
messageSchema.index({ timestamp: 1 });


export default mongoose.model("Message", messageSchema);
