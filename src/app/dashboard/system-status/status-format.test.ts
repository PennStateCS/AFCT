import { describe, expect, it } from 'vitest';
import {
  formatBytes,
  formatDbVersion,
  formatMs,
  formatRate,
  formatRelative,
  formatUptime,
  latencyTone,
  toTitleCase,
  LATENCY_DANGER_MS,
  LATENCY_WARNING_MS,
} from './status-format';

const DASH = '—';

describe('formatUptime', () => {
  it('drops the day part below 24 hours', () => {
    expect(formatUptime(3600)).toBe('1h 0m');
    expect(formatUptime(3661)).toBe('1h 1m');
  });

  it('includes days once there are any', () => {
    expect(formatUptime(90_061)).toBe('1d 1h 1m');
  });

  it('renders a missing or unreadable value rather than NaN', () => {
    expect(formatUptime(null)).toBe(DASH);
    expect(formatUptime(undefined)).toBe(DASH);
    expect(formatUptime(Number.NaN)).toBe(DASH);
  });
});

describe('formatBytes', () => {
  it.each([
    [512, '512 B'],
    [1024, '1.0 KB'],
    [1024 * 1024, '1.0 MB'],
    [1024 * 1024 * 1024, '1.0 GB'],
  ])('scales %i to the right unit', (bytes, expected) => {
    expect(formatBytes(bytes)).toBe(expected);
  });

  it('treats zero as a real value, not a missing one', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(null)).toBe(DASH);
  });
});

describe('formatMs and formatRate', () => {
  it('renders zero rather than falling through to the placeholder', () => {
    expect(formatMs(0)).toBe('0 ms');
    expect(formatRate(0)).toBe('0.0%');
  });

  it('rejects non-finite numbers', () => {
    expect(formatMs(Number.POSITIVE_INFINITY)).toBe(DASH);
    expect(formatRate(Number.NaN)).toBe(DASH);
    expect(formatMs(null)).toBe(DASH);
  });
});

describe('latencyTone', () => {
  /**
   * The badge beside the page heading was amber whenever a latency existed at all, which
   * meant a healthy server and a struggling one wore the same warning. A colour that is
   * always on says nothing, so the point of these cases is that a fast reading is quiet.
   */
  it('stays quiet on a healthy round trip', () => {
    expect(latencyTone(0)).toBe('neutral');
    expect(latencyTone(20)).toBe('neutral');
    expect(latencyTone(LATENCY_WARNING_MS - 1)).toBe('neutral');
  });

  it('warns from the warning threshold up', () => {
    expect(latencyTone(LATENCY_WARNING_MS)).toBe('warning');
    expect(latencyTone(LATENCY_DANGER_MS - 1)).toBe('warning');
  });

  it('escalates at the danger threshold', () => {
    expect(latencyTone(LATENCY_DANGER_MS)).toBe('danger');
    expect(latencyTone(9000)).toBe('danger');
  });

  it('treats a missing reading as nothing to say, not as bad news', () => {
    expect(latencyTone(null)).toBe('neutral');
    expect(latencyTone(undefined)).toBe('neutral');
    expect(latencyTone(Number.NaN)).toBe('neutral');
  });
});

describe('formatDbVersion', () => {
  it('reduces a Postgres banner to the engine and word size', () => {
    expect(formatDbVersion('PostgreSQL 16.2 on x86_64-pc-linux-gnu, compiled by gcc, 64-bit')).toBe(
      'PostgreSQL 16.2 64-bit',
    );
  });

  it('keeps the engine alone when the banner has no word size', () => {
    expect(formatDbVersion('PostgreSQL 15 on aarch64')).toBe('PostgreSQL 15');
  });

  it('falls back to the first clause for an unrecognised banner', () => {
    expect(formatDbVersion('SQLite 3.45.1, some build detail')).toBe('SQLite 3.45.1');
    expect(formatDbVersion(null)).toBe(DASH);
  });
});

describe('toTitleCase', () => {
  it('normalises an environment name for display', () => {
    expect(toTitleCase('production')).toBe('Production');
    expect(toTitleCase('STAGING')).toBe('Staging');
  });

  it('placeholders an absent value', () => {
    expect(toTitleCase(null)).toBe(DASH);
    expect(toTitleCase('')).toBe(DASH);
  });
});

describe('formatRelative', () => {
  const now = 1_700_000_000_000;

  it('reads forwards and backwards from the reference point', () => {
    expect(formatRelative(now + 25 * 60_000, now)).toBe('in 25 minutes');
    expect(formatRelative(now - 5 * 60_000, now)).toBe('5 minutes ago');
  });

  it('singularises one minute and one hour', () => {
    expect(formatRelative(now + 60_000, now)).toBe('in 1 minute');
    expect(formatRelative(now + 3600_000, now)).toBe('in 1 hour');
  });

  it('adds the leftover minutes to an hour span', () => {
    expect(formatRelative(now + 90 * 60_000, now)).toBe('in 1 hour 30 min');
    expect(formatRelative(now + 2 * 3600_000, now)).toBe('in 2 hours');
  });

  it('avoids "in 0 minutes" at the boundary', () => {
    expect(formatRelative(now, now)).toBe('in under a minute');
    expect(formatRelative(now + 5_000, now)).toBe('in under a minute');
    expect(formatRelative(now - 5_000, now)).toBe('just now');
  });
});
