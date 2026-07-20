// Resets the end-to-end test database to a known, freshly seeded state.
//
// The e2e suite creates courses, enrolls students, and archives things, so it needs
// a database it is allowed to trash. This points at a SEPARATE `afct_test` database
// inside the existing dev Postgres container: same server (nothing new to run), but
// your dev data is never touched.
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

const parsed = new URL(url);
const dbName = parsed.pathname.replace(/^\//, '');

// Refuse to point this at anything but the dedicated test database. A typo here
// would otherwise drop the schema of whatever it hit.
if (dbName !== 'afct_test') {
  console.error(`Refusing to reset database "${dbName}": e2e only ever resets "afct_test".`);
  process.exit(1);
}
if (!['localhost', '127.0.0.1', 'postgres'].includes(parsed.hostname)) {
  console.error(`Refusing to reset a non-local database host "${parsed.hostname}".`);
  process.exit(1);
}

const run = (cmd, extraEnv = {}) =>
  execSync(cmd, {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: url, ...extraEnv },
  });

console.log(`[e2e-db] resetting ${dbName}`);

// Drop and recreate rather than `migrate reset`: that command is interactive-ish and
// wants to own the seed step, and we want the plain deploy path the app really uses.
run(
  `docker exec afct-dev-postgres psql -U afct_user -d ${dbName} -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"`,
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
