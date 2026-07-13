import { describe, expect, it } from 'vitest';
import { parseValidDate, formatDeadlineParts, formatDeadlineDual } from './date';

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

describe('formatDeadlineParts / formatDeadlineDual', () => {
  // 2026-11-05 04:59 UTC = Nov 4 11:59 PM EST (course) / Nov 4 08:59 PM PST (viewer).
  const instant = new Date('2026-11-05T04:59:00Z');

  it('shows both zones when the viewer and course zones differ', () => {
    const parts = formatDeadlineParts(instant, 'America/Los_Angeles', 'America/New_York');
    expect(parts.local).toContain('08:59 PM');
    expect(parts.course).toContain('11:59 PM');
    // Zone abbreviations are appended.
    expect(parts.local).toMatch(/P[DS]T/);
    expect(parts.course).toMatch(/E[DS]T/);

    const dual = formatDeadlineDual(instant, 'America/Los_Angeles', 'America/New_York');
    expect(dual).toContain('(your time)');
    expect(dual).toContain('(course time)');
  });

  it('collapses to a single time when the zones match or no course zone is given', () => {
    expect(formatDeadlineParts(instant, 'America/New_York', 'America/New_York').course).toBeNull();
    expect(formatDeadlineParts(instant, 'America/New_York', null).course).toBeNull();
    // The dual string is then just the local time (no separator).
    expect(formatDeadlineDual(instant, 'America/New_York', 'America/New_York')).not.toContain('·');
  });
});
