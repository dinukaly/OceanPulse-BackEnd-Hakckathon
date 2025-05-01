import mongoose from "mongoose";

const WeatherLogSchema = new mongoose.Schema(
  {
    location: {
      lat: Number,
      lng: Number,
      type: {
        type: String,
        default: "Point"
      },
      coordinates: [Number] // [longitude, latitude]
    },
    weather: {
      temperature: Number,
      windSpeed: Number,
      waveHeight: Number,
      condition: String,
    },
    source: {
      type: String,
      default: "OpenWeather",
    },
  },
  { timestamps: true }
);

WeatherLogSchema.index({ location: "2dsphere" });

// Middleware to set coordinates before saving
WeatherLogSchema.pre('save', function(next) {
  if (this.location.lat && this.location.lng) {
    this.location.coordinates = [this.location.lng, this.location.lat];
  }
  next();
});

export default mongoose.model("WeatherLog", WeatherLogSchema);
