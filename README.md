# OceanPulse API

REST API and authenticated WebSocket service for the OceanPulse mobile app, built with Node.js, Express 5, MongoDB/Mongoose, and JWT authentication.

## Features

- Account registration, email verification, sign-in, and password reset through SendGrid.
- Profile management with version checks and a paginated user directory.
- Direct messaging with retry protection, read receipts, unread counts, and WebSocket events.
- Current weather from OpenWeather and hourly wave forecasts from Open-Meteo.
- SOS location records with duplicate prevention and receipt lookup.
- Text-only community posts, likes, and comments.

SOS requests are stored in the database only. The API does not notify emergency responders or dispatch rescue services.

## Getting started

Install Node.js, npm, and a running MongoDB instance, then run:

```sh
npm ci
```

Copy `.env.example` to `.env`, set `JWT_SECRET_KEY`, and update the MongoDB connection and optional service credentials. The `.env` file is ignored by Git.

```sh
npm start
```

The default API root is `http://localhost:3000/api/v1`. The server starts listening after MongoDB connects and required indexes are ready.

## Configuration

| Variable | Purpose |
| --- | --- |
| `JWT_SECRET_KEY` | Required JWT signing secret; at least 32 bytes in production. |
| `MONGODB_URI` | MongoDB connection string. Defaults to `mongodb://127.0.0.1:27017/oceanpulse_db` in development; required in production. |
| `HOST` / `PORT` | Listening address and port; defaults to `0.0.0.0:3000`. |
| `NODE_ENV` | `development`, `test`, or `production`; defaults to `development`. |
| `SENDGRID_API_KEY` | SendGrid key for account verification and password-reset emails. |
| `SENDGRID_FROM_EMAIL` | Verified SendGrid sender address. Configure with the SendGrid key to enable email delivery. |
| `WEATHER_API_KEY` | OpenWeather API key. Weather requests return 503 when it is missing. |
| `CORS_ALLOWED_ORIGINS` | Comma-separated exact HTTP(S) origins. Required in production; include the API origin used by Android WebSocket clients. Use `none` only for clients that omit Origin headers. |
| `TRUST_PROXY` | Defaults to `false`; accepts trusted proxy IPs/CIDRs or `loopback`. |
| `LOG_LEVEL` | `silent`, `error`, `warn`, or `info`; defaults to `info` outside tests. |

See `.env.example` for database timeout, readiness, and shutdown settings. Keep credentials out of source control. Email verification and reset require configured SendGrid delivery; other services can run without it.

## API routes

All paths below are relative to `/api/v1`.

| Route group | Purpose |
| --- | --- |
| `/users` | Registration, verification, login, password reset, own profile, and user directory. |
| `/messages` | Send/history, read acknowledgements, receipt recovery, and unread counts. |
| `/weatherLogs` | Current weather lookup. |
| `/riskPredictions` | Hourly wave-height forecasts; no safety rating is calculated. |
| `/sosAlerts` | Record an SOS request and retrieve the authenticated user's receipts. |
| `/communityAlerts` | Text posts, likes, and comments. |
| `/boatLocations` | Own-location read/write; nearby discovery is disabled. |

Health endpoints:

- `GET /health/live`: process liveness.
- `GET /health/ready`: readiness to serve requests; returns 503 while unavailable.

Protected routes require a valid access token:

```http
Authorization: Bearer <access-token>
```

Authentication endpoints are under `/users`: `POST /register`, `/verify-otp`, `/resend-verification-otp`, `/login`, `/forgot-password`, `/verify-reset-otp`, and `/reset-password`. JSON requests use `Content-Type: application/json`.

Successful REST responses use `{ "success": true, "data": ... }`; paginated lists also include pagination metadata. Failed requests use the corresponding HTTP error status and a JSON error response.

WebSocket messaging connects at `/api/v1/messages/socket`. Connections must authenticate before receiving events; message writes remain REST requests.

## Tests

Run the test directory explicitly:

```sh
node --test test/*.test.js
```

Tests use controlled database, email, and provider substitutes where applicable. Real MongoDB suites are skipped unless their test configuration is supplied.

For database integration tests, supply an explicit test connection string through `INTEGRATION_TEST_MONGODB_URI`, then run:

```sh
npm run test:integration
```

Alternatively, use an existing local MongoDB Docker container exposed on port 27017:

```sh
npm run test:integration -- --container <container-name>
```

The integration runner uses disposable databases and never falls back to the application database URI. Install dependencies in the sibling `OCEANPULSE-FRONTEND-HACKATHON` repository before running the mobile-client integration journeys.

## Project structure

- `index.js`: startup and shutdown lifecycle.
- `app.js`: shared Express application and HTTP/WebSocket server setup.
- `routes/` and `controller/`: HTTP routes and handlers.
- `model/`: Mongoose schemas and indexes.
- `middleware/`: authentication, validation, rate limits, and errors.
- `services/` and `realtime/`: email, health checks, and messaging events.
- `test/`: automated tests.
- `Dockerfile` and `compose.api.yml`: API container configuration.
