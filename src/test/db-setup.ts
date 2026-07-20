/**
 * Points the database suite at the throwaway `afct_test` database before any module
 * imports `@/lib/prisma` (which reads DATABASE_URL when it constructs the adapter).
 *
 * The guard is not ceremony: these tests truncate tables. If DATABASE_URL were left
 * pointing at a developer's dev database, the suite would quietly delete their data.
 */
const DEFAULT_URL = 'postgresql://afct_user:afct_pass@localhost:5432/afct_test';

const url = process.env.E2E_DATABASE_URL ?? process.env.DATABASE_URL ?? DEFAULT_URL;

const parsed = new URL(url);
const dbName = parsed.pathname.replace(/^\//, '');

if (dbName !== 'afct_test') {
  throw new Error(
    `Database tests refuse to run against database "${dbName}". ` +
      `They delete rows, so they only ever target "afct_test". ` +
      `Unset DATABASE_URL or point it at afct_test.`,
  );
}

process.env.DATABASE_URL = url;
