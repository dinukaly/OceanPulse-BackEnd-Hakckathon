// express framework
// body-parser
// mongoose framework

import express from "express";
import bodyParser from "body-parser";
import mongoose from "mongoose";
import cors from "cors";
import { config } from './config/env.js';
import { errorHandler } from './middleware/errorHandler.js';

// Routes
import userRoute from "./routes/UserRoute.js";
import boatLocationRoute from "./routes/BoatLocationRoute.js";
import messageRoute from "./routes/MessageRoute.js";
import sosAlertRoute from "./routes/SosAlertRoute.js";
import weatherLogRoute from "./routes/WeatherLogRoute.js";
import riskPredictionRoute from "./routes/RiskPredictionRoute.js";
import communityAlertRoute from "./routes/CommunityAlertRoute.js";

const app = express();

// Middleware
app.use(express.json()); 
// app.use(bodyParser.json());
app.use(cors());

// Database connection
mongoose
  .connect(config.mongoUri)
  .then(() => console.log("Connected to the database"))
  .catch((error) => console.log("Database connection error:", error));

// Routes
app.use("/api/v1/users", userRoute);
app.use("/api/v1/boatLocations", boatLocationRoute);
app.use("/api/v1/messages", messageRoute);
app.use("/api/v1/sosAlerts", sosAlertRoute);
app.use("/api/v1/weatherLogs", weatherLogRoute);
app.use("/api/v1/riskPredictions", riskPredictionRoute);
app.use("/api/v1/communityAlerts", communityAlertRoute);

// Error handling middleware
app.use(errorHandler);
app.get('/api/v1/test', (req, res) => {
  res.send({ message: 'Backend is reachable!' });
});


app.listen(config.port, () => {
  console.log(`Server is running on port ${config.port}`);
});
