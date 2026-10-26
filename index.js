import { startServer } from './app.js';

try {
  const { server } = await startServer();
  console.log('Connected to the database');
  console.log(`Server is running on port ${server.address().port}`);
} catch (error) {
  console.error(
    'Database/index startup failed. Check connectivity and indexes; node scripts/audit-sos.js reports legacy SOS conflicts.',
    { name: error.name, code: error.code },
  );
  process.exitCode = 1;
}
