// Resets the end-to-end / database test suite's database to a known, freshly seeded state.
//
// The e2e suite creates courses, enrolls students, and archives things, and the
// *.db.test.ts suite deletes rows, so both need a database they are allowed to trash.
// This points at a SEPARATE `afct_test` database inside the existing dev Postgres
// container: same server (nothing new to run), but your dev data is never touched.
//
// Creates the database if it does not exist, so a fresh clone needs no setup step
// beyond `npx playwright install chromium` (Playwright tells you that itself if the
// browser is missing).
//
// Guard rails, because this drops a schema:
//   - it refuses to run against any database whose name is not `afct_test`
//   - it refuses to run against a non-local host
//
// Usage: node scripts/e2e-db.mjs [--no-seed]

import { execSync } from 'node:child_process';

// Same default as playwright.config.ts. Override with E2E_DATABASE_URL if your dev
// Postgres is published somewhere else.
const url =
  process.env.E2E_DATABASE_URL ?? 'postgresql://afct_user:afct_pass@localhost:5432/afct_test';

// Everything here goes through `docker exec` rather than a local psql, because the host
// is not assumed to have a Postgres client installed - only Docker, which the dev stack
// already requires.
const CONTAINER = process.env.AFCT_PG_CONTAINER ?? 'afct-dev-postgres';

const parsed = new URL(url);
const dbName = parsed.pathname.replace(/^\//, '');
const dbUser = decodeURIComponent(parsed.username) || 'afct_user';

// Refuse to point this at anything but the dedicated test database. A typo here would
// otherwise drop the schema of whatever it hit.
if (dbName !== 'afct_test') {
  console.error(`Refusing to reset database "${dbName}": this only ever resets "afct_test".`);
  process.exit(1);
}
if (!['localhost', '127.0.0.1', 'postgres'].includes(parsed.hostname)) {
  console.error(`Refusing to reset a non-local database host "${parsed.hostname}".`);
  process.exit(1);
}

const run = (cmd, extraEnv = {}) =>
  execSync(cmd, { stdio: 'inherit', env: { ...process.env, DATABASE_URL: url, ...extraEnv } });

/** Run psql inside the container and return stdout. */
const psql = (database, sql) =>
  execSync(`docker exec ${CONTAINER} psql -U ${dbUser} -d ${database} -tAc "${sql}"`, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();

function assertContainerRunning() {
  try {
    execSync(`docker exec ${CONTAINER} pg_isready -U ${dbUser}`, { stdio: 'ignore' });
  } catch {
    console.error(
      `Cannot reach Postgres in container "${CONTAINER}".\n` +
        `Start the dev stack first (npm run docker:dev:detached), or set AFCT_PG_CONTAINER.`,
    );
    process.exit(1);
  }
}

/** Create the test database on first run so a fresh clone needs no manual setup. */
function ensureDatabase() {
  // Query the catalog rather than trying CREATE and swallowing the error, so a genuine
  // permissions or connectivity failure still surfaces instead of looking like
  // "already exists".
  const exists = psql('postgres', `SELECT 1 FROM pg_database WHERE datname='${dbName}'`);
  if (exists === '1') return;

  console.log(`[e2e-db] creating ${dbName}`);
  execSync(`docker exec ${CONTAINER} createdb -U ${dbUser} ${dbName}`, { stdio: 'inherit' });
}

assertContainerRunning();
ensureDatabase();

console.log(`[e2e-db] resetting ${dbName}`);

// Drop and recreate the schema rather than `migrate reset`: that command is
// interactive-ish and wants to own the seed step, and we want the plain deploy path the
// app really uses.
run(
  `docker exec ${CONTAINER} psql -U ${dbUser} -d ${dbName} -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"`,
);

console.log('[e2e-db] applying migrations');
run('npx prisma migrate deploy');

if (!process.argv.includes('--no-seed')) {
  console.log('[e2e-db] seeding');
  // The dev seed gives us known users (password123) across admin/faculty/TA/student,
  // which is what the specs sign in as.
  run('npx prisma db seed');
}

console.log('[e2e-db] ready');
