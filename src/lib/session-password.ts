/**
 * Session-invalidation-on-password-change helper.
 *
 * A JWT carries the `passwordChangedAt` value the account had when the token was
 * issued (see the sign-in `jwt` callback). On every request the session callback
 * compares it to the account's current value: if the password has changed since,
 * the token predates the change and its session must be revoked.
 *
 * Kept pure and dependency-free so it can be unit-tested directly.
 */
export function passwordChangedSinceToken(
  tokenValue: unknown,
  dbValue: Date | null | undefined,
): boolean {
  // Normalize both to a millisecond number or null. Tokens issued before this
  // feature existed have no recorded value (undefined) and accounts that never
  // changed a password have null — both read as null, so those sessions are NOT
  // spuriously invalidated on deploy.
  const tok = typeof tokenValue === 'number' ? tokenValue : null;
  const db = dbValue ? dbValue.getTime() : null;
  return tok !== db;
}
