import mongoose from "mongoose";

const BoatLocationSchema = new mongoose.Schema({
  userId: {
    type: String,
    required: true,
  },
  location: {
    type: {
      type: String,
      default: "Point"
    },
    coordinates: [Number] // [longitude, latitude]
  },
  lastUpdated: {
    type: Date,
    default: Date.now
  }
});

// Create a 2dsphere index for geospatial queries
BoatLocationSchema.index({ location: "2dsphere" });

export default mongoose.model("BoatLocation", BoatLocationSchema);
