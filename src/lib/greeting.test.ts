import { describe, expect, it } from 'vitest';

import { greetingFor } from './greeting';

/** 2026-08-26 at a given UTC hour, so a timezone offset moves the local hour predictably. */
const atUtc = (hour: number, minute = 0) => new Date(Date.UTC(2026, 7, 26, hour, minute, 0));

describe('greetingFor', () => {
  it('splits the day at 5, 12 and 17', () => {
    const tz = 'UTC';
    expect(greetingFor(atUtc(5), tz)).toBe('Good morning');
    expect(greetingFor(atUtc(11, 59), tz)).toBe('Good morning');
    expect(greetingFor(atUtc(12), tz)).toBe('Good afternoon');
    expect(greetingFor(atUtc(16, 59), tz)).toBe('Good afternoon');
    expect(greetingFor(atUtc(17), tz)).toBe('Good evening');
  });

  it('carries the evening across midnight', () => {
    // The range that wraps. Written as `hour >= 17 && hour < 5` this is never true and every
    // one of these comes back "Good morning".
    const tz = 'UTC';
    expect(greetingFor(atUtc(23, 59), tz)).toBe('Good evening');
    expect(greetingFor(atUtc(0), tz)).toBe('Good evening');
    expect(greetingFor(atUtc(4, 59), tz)).toBe('Good evening');
  });

  it('greets by the reader’s clock, not the server’s', () => {
    // 19:00 UTC is mid-afternoon in Los Angeles and late evening in Berlin. A dashboard that
    // read the server's own hour would tell both of them the same thing, and be wrong for one.
    const evening = atUtc(19);
    expect(greetingFor(evening, 'UTC')).toBe('Good evening');
    expect(greetingFor(evening, 'America/Los_Angeles')).toBe('Good afternoon');
    expect(greetingFor(evening, 'Europe/Berlin')).toBe('Good evening');

    // 13:00 UTC is breakfast on the US west coast.
    expect(greetingFor(atUtc(13), 'America/Los_Angeles')).toBe('Good morning');
    expect(greetingFor(atUtc(13), 'America/New_York')).toBe('Good morning');
    expect(greetingFor(atUtc(13), 'UTC')).toBe('Good afternoon');
  });

  it('falls back to UTC rather than throwing on a bad timezone', () => {
    // The value comes from a user profile and a settings row, so it can be stale or junk. A
    // greeting is not worth a 500.
    expect(greetingFor(atUtc(9), 'Not/AZone')).toBe('Good morning');
    expect(greetingFor(atUtc(21), '')).toBe('Good evening');
  });

  it('reads midnight as hour zero, not twenty-four', () => {
    // `hour12: false` formats midnight as "24" in several locales, which is not less than 5.
    // This is the assertion that fails if hourCycle ever goes back.
    expect(greetingFor(atUtc(0, 30), 'UTC')).toBe('Good evening');
    expect(greetingFor(atUtc(5, 30), 'UTC')).toBe('Good morning');
  });
});
