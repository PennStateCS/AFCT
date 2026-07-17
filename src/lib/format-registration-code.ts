/**
 * Formats a course registration code for display: upper-cased and grouped as four
 * characters, a hyphen, then the rest (e.g. `abcd1234` → `ABCD-1234`). Codes are 8
 * characters, so this reads as `XXXX-XXXX`. Shorter/empty values are returned
 * upper-cased and ungrouped. This is display-only; the value sent to the join
 * endpoint is still the raw, un-hyphenated code.
 */
export function formatRegistrationCode(code: string | null | undefined): string {
  const c = (code ?? '').toUpperCase();
  return c.length > 4 ? `${c.slice(0, 4)}-${c.slice(4)}` : c;
}
