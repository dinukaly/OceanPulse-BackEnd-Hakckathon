// In CommunityAlertSchema.js
import mongoose from "mongoose";

const CommentSchema = new mongoose.Schema({
  userId: String,
  username: String,
  content: String,
  createdAt: { type: Date, default: Date.now },
});

const PostSchema = new mongoose.Schema({
  userId: String,
  username: String,
  content: String,
  imageUrl: String,
  likes: { type: Number, default: 0 },
  comments: [CommentSchema],
  createdAt: { type: Date, default: Date.now },
});


const CommunityAlert = mongoose.model("CommunityAlert", PostSchema);
export default CommunityAlert;