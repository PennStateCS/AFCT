/**
 * One formatter, because there were two.
 *
 * The status pages and the system-settings pages each had their own, and they disagreed on both
 * rounding and range: the same number read as "4.66 GB" on one screen and "4.7 GB" on the next,
 * and only one of them knew about terabytes, so an ordinary disk reported as "1006.85 GB".
 */

import { describe, expect, it } from 'vitest';
import { DASH, formatBytes } from './format-bytes';

describe('formatBytes', () => {
  it.each([
    [0, '0 B'],
    [512, '512 B'],
    [1024, '1.0 KB'],
    [1536, '1.5 KB'],
    [1024 ** 2, '1.0 MB'],
    [1024 ** 3, '1.0 GB'],
    [5_000_000_000, '4.7 GB'],
    // The range the old status formatter stopped at, which is the size of an ordinary disk.
    [2 * 1024 ** 4, '2.0 TB'],
    [3 * 1024 ** 5, '3.0 PB'],
  ])('writes %i as %s', (bytes, expected) => {
    expect(formatBytes(bytes)).toBe(expected);
  });

  it('keeps whole bytes whole', () => {
    // "512.0 B" is nonsense; a decimal only starts meaning something once a unit is scaled.
    expect(formatBytes(999)).toBe('999 B');
  });

  it('holds the largest unit rather than inventing one past the end of the list', () => {
    expect(formatBytes(9999 * 1024 ** 5)).toMatch(/ PB$/);
  });

  it('says it does not know, rather than printing NaN or zero', () => {
    // A missing value and a genuinely empty one are different answers, and zero is a real size.
    expect(formatBytes(null)).toBe(DASH);
    expect(formatBytes(undefined)).toBe(DASH);
    expect(formatBytes(Number.NaN)).toBe(DASH);
    expect(formatBytes(0)).toBe('0 B');
  });
});
