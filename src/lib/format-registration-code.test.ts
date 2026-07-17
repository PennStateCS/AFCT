import { describe, it, expect } from 'vitest';
import { formatRegistrationCode } from './format-registration-code';

describe('formatRegistrationCode', () => {
  it('groups an 8-char code as XXXX-XXXX, uppercased', () => {
    expect(formatRegistrationCode('abcd2345')).toBe('ABCD-2345');
    expect(formatRegistrationCode('ABCD2345')).toBe('ABCD-2345');
  });

  it('hyphenates after the first four characters for other lengths', () => {
    expect(formatRegistrationCode('abcdef')).toBe('ABCD-EF');
  });

  it('leaves short values ungrouped and handles null/empty', () => {
    expect(formatRegistrationCode('ABCD')).toBe('ABCD');
    expect(formatRegistrationCode('')).toBe('');
    expect(formatRegistrationCode(null)).toBe('');
    expect(formatRegistrationCode(undefined)).toBe('');
  });
});
