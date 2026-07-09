// src/lib/date.ts
export function toISODate(d: Date) {
  // "YYYY-MM-DD"
  return d.toISOString().slice(0, 10);
}

export function fromInputDate(s: string | null | undefined): Date | undefined {
  if (!s) return undefined;
  // Avoid TZ surprises
  return new Date(`${s}T00:00:00`);
}

export function toInputDate(d?: Date): string {
  if (!d) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

type DateInput = Date | string | number;

const toDate = (value: DateInput): Date => (value instanceof Date ? value : new Date(value));

/**
 * Parse a date-ish input, returning `null` when it's missing or doesn't resolve
 * to a real date (i.e. `getTime()` is NaN). Replaces the repeated
 * `new Date(x)` + `Number.isNaN(d.getTime())` guard scattered across routes.
 */
export function parseValidDate(value: DateInput | null | undefined): Date | null {
  if (value == null || value === '') return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatDateTimeInTimeZone(value: DateInput, timeZone = 'UTC') {
  const date = toDate(value);
  if (!Number.isFinite(date.getTime())) return 'Invalid date';
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: '2-digit',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  }).formatToParts(date);
  const lookup = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const month = lookup.month ?? '';
  const day = lookup.day ?? '';
  const year = lookup.year ?? '';
  const hour = lookup.hour ?? '';
  const minute = lookup.minute ?? '';
  const dayPeriod = (lookup.dayPeriod ?? '').toUpperCase();
  return `${month}/${day}/${year} ${hour}:${minute} ${dayPeriod}`.trim();
}

export function formatDateInTimeZone(value: DateInput, timeZone = 'UTC') {
  const date = toDate(value);
  if (!Number.isFinite(date.getTime())) return 'Invalid date';
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: '2-digit',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

export function formatTimeInTimeZone(value: DateInput, timeZone = 'UTC') {
  const date = toDate(value);
  if (!Number.isFinite(date.getTime())) return 'Invalid time';
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  }).formatToParts(date);
  const lookup = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const hour = lookup.hour ?? '';
  const minute = lookup.minute ?? '';
  const dayPeriod = (lookup.dayPeriod ?? '').toUpperCase();
  return `${hour}:${minute} ${dayPeriod}`.trim();
}

export function formatWeekdayInTimeZone(value: DateInput, timeZone = 'UTC') {
  const date = toDate(value);
  if (!Number.isFinite(date.getTime())) return 'Invalid date';
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'long',
  }).format(date);
}
