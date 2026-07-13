import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Truncate a string to at most `max` visible characters, appending an ellipsis when
 * (and only when) content was actually removed. Replaces the ad-hoc
 * `str.substring(0, 46) + (str.length > 47 ? '…' : '')` snippets, which had an
 * off-by-one: a string of exactly `max + 1` chars was cut with no ellipsis, hiding a
 * character with no indication.
 */
export function truncate(value: string, max: number): string {
  if (max < 0 || value.length <= max) return value;
  return value.slice(0, max) + '…';
}
