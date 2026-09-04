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

export function formatDateTimeInTimeZone(value: DateInput, timeZone = 'UTC', hour12 = true) {
  const date = toDate(value);
  if (!Number.isFinite(date.getTime())) return 'Invalid date';
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: '2-digit',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    // 12-hour with AM/PM, or a 24-hour clock (`h23` keeps midnight as "00", not "24").
    ...(hour12 ? { hour12: true } : { hourCycle: 'h23' as const }),
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

export function formatTimeInTimeZone(value: DateInput, timeZone = 'UTC', hour12 = true) {
  const date = toDate(value);
  if (!Number.isFinite(date.getTime())) return 'Invalid time';
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    ...(hour12 ? { hour12: true } : { hourCycle: 'h23' as const }),
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

export type ShortDateParts = {
  /** Abbreviated month, e.g. "Aug". Uppercase it in CSS if a tile wants "AUG". */
  month: string;
  /** Day of month with no leading zero, e.g. "5". */
  day: string;
};

/**
 * The month and day of an instant, as seen in `timeZone`. Split into parts so a caller
 * can stack them (a date tile) or join them ("Aug 5") without re-deriving either.
 */
export function formatShortDateParts(value: DateInput, timeZone = 'UTC'): ShortDateParts {
  const date = toDate(value);
  if (!Number.isFinite(date.getTime())) return { month: '', day: '' };
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    month: 'short',
    day: 'numeric',
  }).formatToParts(date);
  const lookup = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return { month: lookup.month ?? '', day: lookup.day ?? '' };
}

/**
 * A compact deadline: "Sep 4 · 11:30 PM", as read in `timeZone`.
 *
 * For a status strip, where "09/04/26 11:30 PM" is both longer and harder to read at a
 * glance than the month and day. The year is dropped on purpose: these are deadlines inside
 * a term that is already on screen. Returns '' for an unparseable date, like its neighbours.
 */
export function formatShortDateTimeInTimeZone(
  value: DateInput,
  timeZone = 'UTC',
  hour12 = true,
): string {
  const { month, day } = formatShortDateParts(value, timeZone);
  if (!month || !day) return '';
  const time = formatTimeInTimeZone(value, timeZone, hour12);
  return time ? `${month} ${day} · ${time}` : `${month} ${day}`;
}

/**
 * Whole calendar days from `from` to `value`, counted in `timeZone`.
 *
 * Calendar days, not 24-hour spans: something due at 1am tomorrow is one day away even
 * though it is six hours off, which is the difference between a reader seeing "Tomorrow"
 * and seeing "Due today". Both instants are reduced to their Y/M/D in the zone and
 * compared as UTC midnights, so a DST shift in between cannot move the answer.
 */
export function daysUntilInTimeZone(
  value: DateInput,
  timeZone = 'UTC',
  from: DateInput = new Date(),
): number | null {
  const target = toDate(value);
  const origin = toDate(from);
  if (!Number.isFinite(target.getTime()) || !Number.isFinite(origin.getTime())) return null;

  const midnightUtc = (date: Date) => {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date);
    const lookup = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return Date.UTC(Number(lookup.year), Number(lookup.month) - 1, Number(lookup.day));
  };

  return Math.round((midnightUtc(target) - midnightUtc(origin)) / 86_400_000);
}

/** The short zone abbreviation (e.g. "EST", "GMT+2") for an instant in a zone. */
export function zoneAbbrev(value: DateInput, timeZone = 'UTC'): string {
  const date = toDate(value);
  if (!Number.isFinite(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    timeZoneName: 'short',
  }).formatToParts(date);
  return parts.find((part) => part.type === 'timeZoneName')?.value ?? '';
}

export type DualDeadline = {
  /** The deadline formatted in the viewer's local zone, with its abbreviation. */
  local: string;
  /** The deadline in the course's zone (with abbreviation), or null when it matches the viewer's. */
  course: string | null;
};

/**
 * A deadline shown in **both** the viewer's local zone and the course's zone, so a
 * student in a different timezone can't misjudge the cutoff. When the two zones match
 * (or no course zone is given), `course` is null and only `local` is meaningful.
 */
export function formatDeadlineParts(
  value: DateInput,
  viewerZone: string,
  courseZone?: string | null,
  hour12 = true,
): DualDeadline {
  const local = `${formatDateTimeInTimeZone(value, viewerZone, hour12)} ${zoneAbbrev(value, viewerZone)}`.trim();
  if (!courseZone || courseZone === viewerZone) {
    return { local, course: null };
  }
  const course = `${formatDateTimeInTimeZone(value, courseZone, hour12)} ${zoneAbbrev(value, courseZone)}`.trim();
  return { local, course };
}

/**
 * Single-line dual-zone deadline string, e.g.
 * `11/05/26 11:59 PM EST (your time) · 08:59 PM PST (course time)`.
 * Falls back to just the local time when the zones match.
 */
export function formatDeadlineDual(
  value: DateInput,
  viewerZone: string,
  courseZone?: string | null,
  hour12 = true,
): string {
  const { local, course } = formatDeadlineParts(value, viewerZone, courseZone, hour12);
  if (!course) return local;
  return `${local} (your time) · ${course} (course time)`;
}
