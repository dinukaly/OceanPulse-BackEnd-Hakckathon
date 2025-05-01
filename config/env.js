import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Configure dotenv with the path to the .env file
dotenv.config({ path: path.resolve(__dirname, '../.env') });

export const config = {
    port: process.env.PORT || 3000,
    mongoUri: process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/oceanpulse_db",
    jwtSecret: process.env.JWT_SECRET_KEY,
    weatherApiKey: process.env.WEATHER_API_KEY,
    nodeEnv: process.env.NODE_ENV || 'development'
};

// Validate required environment variables
const requiredEnvVars = ['JWT_SECRET_KEY', 'WEATHER_API_KEY'];

requiredEnvVars.forEach(envVar => {
    if (!process.env[envVar]) {
        throw new Error(`Environment variable ${envVar} is required`);
    }
});

export default config;