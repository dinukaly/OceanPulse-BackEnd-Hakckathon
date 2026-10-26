import express from 'express';
import cors from 'cors';
import { createServer } from 'node:http';
import mongoose from 'mongoose';
import { config } from './config/env.js';
import { AppError, errorHandler } from './middleware/errorHandler.js';
import AuthRateLimit from './model/AuthRateLimitSchema.js';
import SosAlert from './model/SosAlertSchema.js';
import Message from './model/MessageSchema.js';
import { attachMessageSocket } from './realtime/messageSocket.js';

// Routes
import userRoute from './routes/UserRoute.js';
import boatLocationRoute from './routes/BoatLocationRoute.js';
import messageRoute from './routes/MessageRoute.js';
import sosAlertRoute from './routes/SosAlertRoute.js';
import weatherLogRoute from './routes/WeatherLogRoute.js';
import riskPredictionRoute from './routes/RiskPredictionRoute.js';
import communityAlertRoute from './routes/CommunityAlertRoute.js';

export function createApp() {
  const app = express();

  // Middleware
  app.use(express.json());
  app.use(cors());

  // Routes
  app.use('/api/v1/users', userRoute);
  app.use('/api/v1/boatLocations', boatLocationRoute);
  app.use('/api/v1/messages', messageRoute);
  app.use('/api/v1/sosAlerts', sosAlertRoute);
  app.use('/api/v1/weatherLogs', weatherLogRoute);
  app.use('/api/v1/riskPredictions', riskPredictionRoute);
  app.use('/api/v1/communityAlerts', communityAlertRoute);

  app.get('/api/v1/test', (req, res) => {
    res.send({ message: 'Backend is reachable!' });
  });

  // Error handling middleware
  app.use((req, res, next) => next(new AppError('Route not found', 404)));
  app.use(errorHandler);

  return app;
}

// Production and integration tests use the same routes, middleware and index gates.
export async function startServer({
  mongoUri = config.mongoUri,
  dbName,
  port = config.port,
  host,
} = {}) {
  let server;
  let sockets;
  try {
    await mongoose.connect(mongoUri, dbName ? { dbName } : {});
    await AuthRateLimit.init();
    // Keep the durable-write index gates, including when autoIndex is disabled.
    await SosAlert.init();
    await SosAlert.createIndexes();
    await Message.init();
    await Message.createIndexes();

    server = createServer(createApp());
    sockets = attachMessageSocket(server);
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, host, () => {
        server.off('error', reject);
        resolve();
      });
    });

    let closing;
    const close = () => {
      closing ||= (async () => {
        sockets.close();
        try {
          await new Promise((resolve, reject) => {
            server.close((error) => (error ? reject(error) : resolve()));
          });
        } finally {
          await mongoose.disconnect();
        }
      })();
      return closing;
    };
    return { server, sockets, close };
  } catch (error) {
    sockets?.close();
    if (server?.listening)
      await new Promise((resolve) => server.close(resolve));
    await mongoose.disconnect();
    throw error;
  }
}
