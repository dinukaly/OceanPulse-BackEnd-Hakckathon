import mongoose from "mongoose";

const SosAlertSchema = new mongoose.Schema(
  {
    latitude: {
      type: Number,
      required: true,
    },
    longitude: {
      type: Number,
      required: true,
    },
    timestamp: {
      type: Date,
    },
    userId: {
      type: String,
      required: true,
    },
    username: {
      type: String,
      required: true,
    },
    isHandled:{
      type: Boolean,
      default: false
    }
  },
);

SosAlertSchema.index({ userId: 1, isHandled: 1, _id: -1 });
export default mongoose.model("SOSAlert", SosAlertSchema);
