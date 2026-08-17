/** The em dash shown wherever a value could not be determined. */
export const DASH = '—';

const UNITS = ['KB', 'MB', 'GB', 'TB', 'PB'] as const;

/**
 * A size in bytes, written the way a person would say it.
 *
 * There were two of these, one on the status pages and one on the system-settings pages, and
 * they disagreed: the same number printed as "4.66 GB" on one screen and "4.7 GB" on the next,
 * and only one of them had a unit above GB, so a terabyte disk read as "1006.85 GB". Two
 * implementations of the same idea is one more than can be kept in step, so this is the only
 * one, and both of those modules re-export it.
 *
 * One decimal place, because the second is precision nobody acts on: an administrator deciding
 * whether to clear space wants "4.7 GB", not "4.66 GB". Whole bytes stay whole, since "512.0 B"
 * is nonsense.
 *
 * Binary units throughout (1 KB = 1024 B), matching what `df` and the container tooling report,
 * so a number here can be compared with one from the host without converting anything.
 *
 * The loop is deliberate. The version that tested each range with its own branch stopped at GB,
 * and nobody noticed until a screen started reporting disk sizes; adding a unit to the list is
 * now the whole change.
 */
export function formatBytes(bytes?: number | null): string {
  if (bytes == null || Number.isNaN(Number(bytes))) return DASH;

  const value = Number(bytes);
  if (Math.abs(value) < 1024) return `${value} B`;

  let scaled = value / 1024;
  let unit = 0;
  while (Math.abs(scaled) >= 1024 && unit < UNITS.length - 1) {
    scaled /= 1024;
    unit += 1;
  }
  return `${scaled.toFixed(1)} ${UNITS[unit]}`;
}
