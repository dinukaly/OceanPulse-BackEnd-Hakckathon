// express framework
// body-parser
// mongoose framework

import express from "express";
import bodyParser from "body-parser";
import mongoose from "mongoose";
import cors from "cors";
import { config } from './config/env.js';
import { AppError, errorHandler } from './middleware/errorHandler.js';
import AuthRateLimit from './model/AuthRateLimitSchema.js';
import SosAlert from './model/SosAlertSchema.js';

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

// Routes
app.use("/api/v1/users", userRoute);
app.use("/api/v1/boatLocations", boatLocationRoute);
app.use("/api/v1/messages", messageRoute);
app.use("/api/v1/sosAlerts", sosAlertRoute);
app.use("/api/v1/weatherLogs", weatherLogRoute);
app.use("/api/v1/riskPredictions", riskPredictionRoute);
app.use("/api/v1/communityAlerts", communityAlertRoute);

app.get('/api/v1/test', (req, res) => {
  res.send({ message: 'Backend is reachable!' });
});

// Error handling middleware
app.use((req, res, next) => next(new AppError('Route not found', 404)));
app.use(errorHandler);

async function start() {
  try {
    await mongoose.connect(config.mongoUri);
    await AuthRateLimit.init();
    // Do not serve SOS writes without the database's duplicate-prevention guarantee.
    // createIndexes also enforces this gate when automatic indexing is disabled.
    await SosAlert.init();
    await SosAlert.createIndexes();
    console.log('Connected to the database');
    app.listen(config.port, () => {
      console.log(`Server is running on port ${config.port}`);
    });
  } catch (error) {
    console.error('Database/index startup failed. Check connectivity and indexes; node scripts/audit-sos.js reports legacy SOS conflicts.',
      { name: error.name, code: error.code });
    await mongoose.disconnect();
    process.exitCode = 1;
  }
}

start();
