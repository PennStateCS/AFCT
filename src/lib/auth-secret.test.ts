import { describe, it, expect, vi, afterEach } from 'vitest';
import { requireAuthSecret, MIN_AUTH_SECRET_LENGTH } from './auth-secret';

describe('requireAuthSecret', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns the secret when it meets the minimum length', () => {
    const secret = 'a'.repeat(MIN_AUTH_SECRET_LENGTH);
    vi.stubEnv('NEXTAUTH_SECRET', secret);
    expect(requireAuthSecret()).toBe(secret);
  });

  it('throws when the secret is missing/empty', () => {
    vi.stubEnv('NEXTAUTH_SECRET', '');
    expect(() => requireAuthSecret()).toThrow(/at least 32 characters/i);
  });

  it('throws when the secret is too short', () => {
    vi.stubEnv('NEXTAUTH_SECRET', 'a'.repeat(MIN_AUTH_SECRET_LENGTH - 1));
    expect(() => requireAuthSecret()).toThrow(/too short/i);
  });
});
