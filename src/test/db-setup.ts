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

/**
 * A secret-encryption key for the suite, so tests can exercise the encrypted columns (the OIDC
 * client secret, the LTI private key) rather than skipping the encryption entirely.
 *
 * A fixed throwaway value on purpose. It protects nothing: the database it unlocks is deleted
 * between runs, and a test that needs to prove behaviour *without* a key sets and unsets the
 * variable itself. Any real deployment gets a generated one from the installer.
 */
process.env.AFCT_SECRET_KEY ??= 'test-only-secret-encryption-key-not-used-anywhere-real';
