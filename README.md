# Gotur VIP

Gotur VIP is a multi-tenant reservation platform built on Express and Sequelize.
It serves the public web app together with a background worker that keeps tenant
reservations up to date.

## Quick start

1. Install dependencies:
   ```bash
   npm install
   ```
2. Duplicate the provided `.env` and adjust the credentials for your
   infrastructure if needed.
3. Start the HTTP server:
   ```bash
   npm run dev
   ```
4. Access the application from `http://localhost:4000`.

## Environment configuration

The application reads its configuration from the `.env` file at the project
root. The default values are suitable for local development, but you should
change them before deploying to any shared environment.

| Variable | Description |
| --- | --- |
| `PORT` | Port number Express listens on. |
| `SESSION_SECRET` | Secret used to sign Express session cookies. |
| `DB_*` | Connection settings for tenant specific databases. |
| `GOTUR_DB_*` | Connection settings for the common Gotur database that stores session and shared models. |
| `RESERVATION_JOB_TENANT_KEYS` | A comma separated list of tenant identifiers processed by the reservation cleanup worker. |
| `API_KEY_HASH_SECRET` | Secret used to HMAC-hash partner API keys before they are stored/compared (falls back to `SESSION_SECRET`). |

All configuration keys are optional—if a value is missing in the `.env` file the
code falls back to the safe default that was used previously. When running in
production, make sure the secrets are rotated and not left to their default
values.

## Tenant lifecycle tasks

Most application features depend on tenant specific databases. A subdomain is
only ever resolved to a tenant if there is a matching, `active` `Firm` record
in the common Gotur database (see `utilities/database.js` and
`utilities/tenantConfig.js`)—the subdomain itself is never used directly as a
database name. When a new tenant's database is provisioned for the first time
the application will automatically:

- connect to the tenant database defined by `Firm.dbName` (resolved from the
  `Firm.key` record, using the `DB_*` credentials),
- run `sequelize.sync({ alter: true })` to ensure tables are created,
- seed default `FirmUser` records (`GOTUR`, `WEB`, `goturbilet`) with a
  randomly generated, unique-per-user password. The generated passwords are
  printed to the server log **once** at creation time so an operator can hand
  them to the firm; every seeded user has `forcePasswordReset: true` and must
  change their password on first login,
- populate the `Permission` table if it is empty.

You can verify the connection by visiting a page under the tenant subdomain or
by requiring `getTenantConnection` from `utilities/database.js` inside a script
that runs in the project context.

## Reservation cleanup job

The reservation cleanup job cancels expired ticket reservations automatically.
It is implemented in [`bin/reservationCleanupJob.js`](bin/reservationCleanupJob.js)
and starts together with the HTTP server via `bin/www`.

### Scheduling options

Set `RESERVATION_JOB_TENANT_KEYS` in the `.env` file to a comma-separated list
of tenants that should be processed. If left empty the job will run only for
subdomains that establish a session during runtime.

### Manual control

```javascript
const job = require('./bin/reservationCleanupJob');
job.stop(); // stops the scheduler
job.start(); // restarts it
```

You can extend the job handler with any notification logic that your
infrastructure requires (for example, sending alerts when reservations are
canceled).
Add notification hooks inside the job if a user/branch alert system is available.

## Partner API keys

Partner requests to `/api` must send a valid `X-Api-Key` (plus `X-Tenant-Key`)
header, verified by `middlewares/apiKeyAuth.js`. Only a salted/HMAC **hash** of
the key is ever stored in the `apiKey` table (`keyHash` column)—raw keys are
never persisted. To issue a new key for a partner:

```bash
node build-scripts/generateApiKey.js
```

This prints a random raw key (hand it to the partner, it cannot be recovered
later) and the corresponding hash, which should be inserted into the `apiKey`
table's `keyHash` column for that tenant.

## Client Build Testing

To verify the production client bundle locally, install dependencies with `npm install` (or `npm ci` if you prefer a clean install), run `npm run build-client`, then confirm that a hashed `app.<hash>.js` file appears in `public/js/` and that `views/layout.pug` (or `layout.html`) references the new filename with the reported integrity value.
