/**
 * Truncate a string to at most `max` visible characters, appending an ellipsis when
 * (and only when) content was actually removed. Replaces the ad-hoc
 * `str.substring(0, 46) + (str.length > 47 ? '…' : '')` snippets, which had an
 * off-by-one: a string of exactly `max + 1` chars was cut with no ellipsis, hiding a
 * character with no indication.
 *
 * A negative `max` returns the value untouched rather than throwing, so a bad constant
 * degrades to "no truncation" instead of an empty cell.
 */
export function truncate(value: string, max: number): string {
  if (max < 0 || value.length <= max) return value;
  return value.slice(0, max) + '…';
}
