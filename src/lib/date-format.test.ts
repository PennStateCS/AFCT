import { describe, expect, it } from 'vitest';
import {
  parseValidDate,
  formatDeadlineParts,
  formatDeadlineDual,
  formatShortDateParts,
  daysUntilInTimeZone,
} from './date-format';

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

describe('formatShortDateParts and daysUntilInTimeZone', () => {
  // 02:00Z on 2 March is 21:00 on 1 MARCH in New York. Every assertion below turns on
  // that, so reading either value in UTC fails rather than passing by coincidence.
  const lateNight = '2025-03-02T02:00:00Z';

  it('reads the month and day in the given zone, not UTC', () => {
    expect(formatShortDateParts(lateNight, 'America/New_York')).toEqual({
      month: 'Mar',
      day: '1',
    });
    expect(formatShortDateParts(lateNight, 'UTC')).toEqual({ month: 'Mar', day: '2' });
  });

  it('drops the leading zero from the day', () => {
    expect(formatShortDateParts('2025-09-05T12:00:00Z', 'UTC').day).toBe('5');
  });

  it('counts whole calendar days in the zone, not elapsed hours', () => {
    const from = '2025-02-28T12:00:00Z';
    // 38 hours apart, but one calendar day in New York.
    expect(daysUntilInTimeZone(lateNight, 'America/New_York', from)).toBe(1);
    // Same instants read in UTC land on the next day again.
    expect(daysUntilInTimeZone(lateNight, 'UTC', from)).toBe(2);
  });

  it('counts an earlier instant as negative and the same day as zero', () => {
    const from = '2025-03-10T18:00:00Z';
    expect(daysUntilInTimeZone('2025-03-10T01:00:00Z', 'UTC', from)).toBe(0);
    expect(daysUntilInTimeZone('2025-03-08T12:00:00Z', 'UTC', from)).toBe(-2);
  });

  it('survives a DST change between the two instants', () => {
    // US DST starts 9 March 2025. Nine calendar days, one of them 23 hours long.
    expect(
      daysUntilInTimeZone('2025-03-15T12:00:00Z', 'America/New_York', '2025-03-06T12:00:00Z'),
    ).toBe(9);
  });

  it('returns null or empty parts for an unusable date', () => {
    expect(daysUntilInTimeZone('not-a-date', 'UTC')).toBeNull();
    expect(formatShortDateParts('not-a-date', 'UTC')).toEqual({ month: '', day: '' });
  });
});

describe('every time on screen asks for the clock the installation chose', () => {
  /**
   * A source check, deliberately.
   *
   * `hour12` defaults to true on the formatters, which is what let twenty-two call sites drift
   * into showing 12-hour times to an installation that had asked for 24: nothing failed, the
   * clock was simply wrong in most of the app. A runtime test cannot catch that, because each
   * of those calls was correct on its own terms. This counts the arguments instead.
   *
   * Multiline calls are why this walks the brackets rather than matching a regular expression:
   * several of the calls it has to judge span four lines.
   */
  it('passes one to every formatter that prints an hour', async () => {
    const { readFile, readdir } = await import('node:fs/promises');
    const { join } = await import('node:path');

    const files: string[] = [];
    const walk = async (dir: string) => {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) await walk(full);
        else if (/\.tsx?$/.test(entry.name) && !entry.name.includes('.test.')) files.push(full);
      }
    };
    await walk('src');

    const offenders: string[] = [];
    for (const file of files) {
      // The formatters' own file is where the defaults live.
      if (file.includes('date-format')) continue;
      const text = await readFile(file, 'utf8');
      for (const match of text.matchAll(/format(?:DateTime|Time)InTimeZone\(/g)) {
        let index = match.index + match[0].length;
        let depth = 1;
        let args = 1;
        while (index < text.length && depth > 0) {
          const char = text[index]!;
          if ('([{'.includes(char)) depth += 1;
          else if (')]}'.includes(char)) depth -= 1;
          else if (char === ',' && depth === 1) args += 1;
          index += 1;
        }
        if (args < 3) {
          offenders.push(`${file}:${text.slice(0, match.index).split('\n').length}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});
