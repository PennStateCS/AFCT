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

/** The domain part of an email, lowercased (e.g. `a@PSU.edu` → `psu.edu`). '' if malformed. */
export function getEmailDomain(email: string): string {
  const at = String(email).lastIndexOf('@');
  return at < 0 ? '' : email.slice(at + 1).trim().toLowerCase();
}

/**
 * Validate a bare hostname like `psu.edu` or `mail.psu.edu`: dot-separated labels
 * of letters/digits/hyphens (not starting/ending with a hyphen) and an alphabetic
 * TLD of ≥2 chars. No scheme, `@`, or path.
 */
export function isValidDomain(domain: string): boolean {
  return /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/.test(
    String(domain).trim().toLowerCase(),
  );
}

/**
 * Parse an admin-entered allow-list — domains separated by commas, semicolons, or
 * whitespace/newlines — into normalized, de-duplicated domains. A leading `@` on a
 * token is stripped (`@psu.edu` → `psu.edu`). Tokens that fail {@link isValidDomain}
 * are returned separately so the caller can reject the save with a helpful message.
 */
export function parseDomainList(raw: string): { domains: string[]; invalid: string[] } {
  const tokens = String(raw ?? '')
    .split(/[\s,;]+/)
    .map((t) => t.trim().replace(/^@/, '').toLowerCase())
    .filter(Boolean);
  const domains: string[] = [];
  const invalid: string[] = [];
  for (const token of tokens) {
    if (!isValidDomain(token)) invalid.push(token);
    else if (!domains.includes(token)) domains.push(token);
  }
  return { domains, invalid };
}

/**
 * Is `email` permitted to sign up given the configured allow-list (the canonical
 * comma-separated `SystemSettings.signupAllowedDomains`)? An **empty** list means no
 * restriction — every domain is allowed. Otherwise the email's domain must match one
 * of the listed domains exactly (case-insensitive).
 */
export function isEmailDomainAllowed(email: string, allowedDomainsCsv: string): boolean {
  const { domains } = parseDomainList(allowedDomainsCsv);
  if (domains.length === 0) return true;
  const domain = getEmailDomain(email);
  return domain.length > 0 && domains.includes(domain);
}
