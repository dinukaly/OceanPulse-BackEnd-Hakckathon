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

export default mongoose.model("SOSAlert", SosAlertSchema);
