/**
 * Canonicalize an email for storage and comparison: trimmed and lowercased.
 * Non-string input (missing field, wrong type) normalizes to an empty string, so
 * callers can treat "" as "no usable email" (or `normalizeEmail(x) || null`).
 * Centralizes the `trim().toLowerCase()` idiom that had drifted across the auth
 * and user routes.
 */
export function normalizeEmail(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}
