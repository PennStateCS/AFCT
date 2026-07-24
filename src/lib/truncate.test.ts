import { describe, it, expect } from 'vitest';
import { truncate } from './truncate';

describe('truncate', () => {
  it('returns short strings unchanged', () => {
    expect(truncate('hello', 10)).toBe('hello');
  });

  it('returns a string of exactly max unchanged', () => {
    expect(truncate('abcde', 5)).toBe('abcde');
  });

  it('truncates and appends an ellipsis when over the limit', () => {
    expect(truncate('abcdef', 5)).toBe('abcde…');
  });

  it('adds the ellipsis for a string of exactly max + 1 (the old off-by-one)', () => {
    // The former `substring(0, 46) + (len > 47 ? '…' : '')` dropped this char silently.
    expect(truncate('abcdef', 5)).toBe('abcde…');
    expect(truncate('123456', 5)).toBe('12345…');
  });

  it('handles empty strings and zero max', () => {
    expect(truncate('', 5)).toBe('');
    expect(truncate('abc', 0)).toBe('…');
  });

  it('returns the value unchanged for a negative max rather than throwing', () => {
    expect(truncate('abc', -1)).toBe('abc');
  });
});
