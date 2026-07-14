import { describe, expect, it } from 'vitest';

import { passwordChangedSinceToken } from './session-password';

describe('passwordChangedSinceToken', () => {
  it('does not revoke when neither side has a recorded change (fresh deploy)', () => {
    // Pre-existing token (no field) + account that never changed its password.
    expect(passwordChangedSinceToken(undefined, null)).toBe(false);
    expect(passwordChangedSinceToken(null, null)).toBe(false);
  });

  it('does not revoke when the token matches the current value', () => {
    const t = Date.UTC(2026, 0, 1);
    expect(passwordChangedSinceToken(t, new Date(t))).toBe(false);
  });

  it('revokes when the password changed after the token was issued', () => {
    const issued = Date.UTC(2026, 0, 1);
    const changed = new Date(Date.UTC(2026, 0, 2));
    // Token issued before the change (token value is older, or absent).
    expect(passwordChangedSinceToken(issued, changed)).toBe(true);
    expect(passwordChangedSinceToken(undefined, changed)).toBe(true);
    expect(passwordChangedSinceToken(null, changed)).toBe(true);
  });

  it('revokes when a later change moves the value forward again', () => {
    const tokenValue = Date.UTC(2026, 0, 2);
    const laterChange = new Date(Date.UTC(2026, 0, 3));
    expect(passwordChangedSinceToken(tokenValue, laterChange)).toBe(true);
  });
});
