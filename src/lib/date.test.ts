import { describe, expect, it } from 'vitest';
import { parseValidDate } from './date';

describe('parseValidDate', () => {
  it('parses a valid date string', () => {
    const d = parseValidDate('2026-07-09T12:00:00Z');
    expect(d).toBeInstanceOf(Date);
    expect(d?.toISOString()).toBe('2026-07-09T12:00:00.000Z');
  });

  it('passes a Date through', () => {
    const now = new Date('2026-01-01T00:00:00Z');
    expect(parseValidDate(now)).toBe(now);
  });

  it('returns null for missing or empty input', () => {
    expect(parseValidDate(null)).toBeNull();
    expect(parseValidDate(undefined)).toBeNull();
    expect(parseValidDate('')).toBeNull();
  });

  it('returns null for an unparseable string', () => {
    expect(parseValidDate('not-a-date')).toBeNull();
  });
});
