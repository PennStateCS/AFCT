import { describe, expect, it } from 'vitest';
import { normalizeEmail, isValidEmail } from './email';

describe('normalizeEmail', () => {
  it('trims and lowercases', () => {
    expect(normalizeEmail('  Foo@Example.COM ')).toBe('foo@example.com');
  });
  it('returns "" for non-string input', () => {
    expect(normalizeEmail(null)).toBe('');
    expect(normalizeEmail(undefined)).toBe('');
    expect(normalizeEmail(123)).toBe('');
  });
  it('supports the "|| null" idiom for absent values', () => {
    expect(normalizeEmail(null) || null).toBeNull();
  });
});

describe('isValidEmail', () => {
  it('accepts a well-formed address', () => {
    expect(isValidEmail('foo@example.com')).toBe(true);
  });
  it('rejects obvious junk', () => {
    for (const bad of ['', 'foo', 'foo@', '@bar.com', 'foo@bar', 'a b@c.com']) {
      expect(isValidEmail(bad)).toBe(false);
    }
  });
});
