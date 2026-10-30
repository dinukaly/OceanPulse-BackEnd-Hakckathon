import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { parseEnvironment } from './validation.js';

dotenv.config({ path: fileURLToPath(new URL('../.env', import.meta.url)) });
export const config = parseEnvironment(process.env);
export default config;
