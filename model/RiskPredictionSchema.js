import mongoose from "mongoose";

const RiskPredictionSchema = new mongoose.Schema(
  {
    location: {
      lat: Number,
      lng: Number,
    },
    predictedWaveHeight: Number,
    predictedWindSpeed: Number,
    riskLevel: {
      type: String,
      enum: ["Low", "Medium", "High"],
    },
    source: {
      type: String,
      default: "AI Predictor",
    },
  },
);

export default mongoose.model("RiskPrediction", RiskPredictionSchema);
