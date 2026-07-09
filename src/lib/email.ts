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

/**
 * Lightweight "looks like an email" check (a single `@` with non-empty local and
 * dotted domain parts). Intentionally permissive — real delivery is the only true
 * validation — but enough to reject obvious junk in forms and API bodies.
 */
export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
