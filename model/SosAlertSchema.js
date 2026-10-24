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
SosAlertSchema.index({ userId: 1 }, {
  name: 'one_active_sos_per_user', unique: true, partialFilterExpression: { isHandled: false },
});
export default mongoose.model("SOSAlert", SosAlertSchema);
