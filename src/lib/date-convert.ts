/**
 * Utility functions for timezone-aware date handling.
 *
 * The two directions of the `<input type="datetime-local">` round trip live here
 * together on purpose: `toDateTimeInTimezone` reads a form value as an instant, and
 * `toDateTimeLocalInTimeZone` writes an instant back out as a form value. They have to
 * agree, and a due date is the thing that breaks when they do not.
 */

/**
 * Instant -> "YYYY-MM-DDTHH:MM" as read in `timeZone`, the value an
 * `<input type="datetime-local">` expects. Returns '' for an unparseable date so a form
 * field renders empty rather than "Invalid Date".
 *
 * `hourCycle: 'h23'` rather than `hour12: false`, matching the parsing direction below:
 * en-US with `hour12: false` has been observed reporting midnight as hour "24", which is
 * not a valid `datetime-local` value and would silently blank the field.
 */
export function toDateTimeLocalInTimeZone(date: Date | string, timeZone: string): string {
  const d = new Date(date);
  if (!Number.isFinite(d.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(d);
  const lookup = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const year = lookup.year ?? '0000';
  const month = lookup.month ?? '01';
  const day = lookup.day ?? '01';
  const hour = lookup.hour ?? '00';
  const minute = lookup.minute ?? '00';
  return `${year}-${month}-${day}T${hour}:${minute}`;
}

/**
 * Render a `datetime-local` string ("2026-01-10T23:59") for reading ("2026-01-10 23:59").
 * Purely cosmetic: it does not reinterpret the value, so it stays in whatever timezone
 * the string was already expressed in.
 */
export function formatDateTimeLocal(value: string | undefined | null): string {
  return value ? value.replace('T', ' ') : '';
}

/**
 * Convert a datetime string to UTC based on the user's timezone
 * @param datetimeString - Date string in YYYY-MM-DD or YYYY-MM-DDTHH:MM format (interpreted as local time in the timezone)
 * @param timezone - IANA timezone string (e.g., 'America/New_York')
 * @returns Date object in UTC representing what that local time would be in UTC
 */
export function toEndOfDayInTimezone(
  datetimeString: string,
  timezone: string = 'America/New_York',
): Date {
  if (/[zZ]$/.test(datetimeString) || /[+-]\d{2}:\d{2}$/.test(datetimeString)) {
    return new Date(datetimeString);
  }
  const hasTime = datetimeString.includes('T');

  let year: number, month: number, day: number, hour: number, minute: number;

  if (hasTime) {
    const [datePart = '', timePart = ''] = datetimeString.split('T');
    [year = NaN, month = NaN, day = NaN] = datePart.split('-').map(Number);
    const timeParts = timePart.split(':');
    hour = Number(timeParts[0]);
    minute = Number(timeParts[1]);
  } else {
    [year = NaN, month = NaN, day = NaN] = datetimeString.split('-').map(Number);
    hour = 23;
    minute = 59;
  }

  // We need to find what UTC time corresponds to the given local time in the timezone.
  // Start with an approximate UTC guess (assuming UTC)
  const guess = new Date(Date.UTC(year, month - 1, day, hour, minute, 0, 0));

  // Get the offset for this guess
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    // h23 keeps midnight as "00"; en-US with hour12:false reports it as "24",
    // which throws the offset math off by a full day when the guess lands on
    // midnight in the target zone (e.g. UTC).
    hourCycle: 'h23',
  });

  const parts = formatter.formatToParts(guess);
  const lookup = Object.fromEntries(parts.map((part) => [part.type, part.value]));

  const formattedYear = Number(lookup.year);
  const formattedMonth = Number(lookup.month);
  const formattedDay = Number(lookup.day);
  const formattedHour = Number(lookup.hour);
  const formattedMinute = Number(lookup.minute);

  // Calculate what the offset is: (formatted as local) - (our UTC guess)
  const offsetMinutes =
    (Date.UTC(formattedYear, formattedMonth - 1, formattedDay, formattedHour, formattedMinute) -
      guess.getTime()) /
    60000;

  // The actual UTC time is: guess - offset (remove the offset that was applied)
  return new Date(guess.getTime() - offsetMinutes * 60_000);
}

/**
 * Convert a datetime string to UTC based on the user's timezone
 * @param datetimeString - Date string in YYYY-MM-DD or YYYY-MM-DDTHH:MM format (interpreted as local time in the timezone)
 * @param timezone - IANA timezone string (e.g., 'America/New_York')
 * @returns Date object in UTC representing what that local time would be in UTC
 */
export function toDateTimeInTimezone(
  datetimeString: string,
  timezone: string = 'America/New_York',
): Date {
  if (/[zZ]$/.test(datetimeString) || /[+-]\d{2}:\d{2}$/.test(datetimeString)) {
    return new Date(datetimeString);
  }
  const hasTime = datetimeString.includes('T');

  let year: number, month: number, day: number, hour: number, minute: number;

  if (hasTime) {
    const [datePart = '', timePart = ''] = datetimeString.split('T');
    [year = NaN, month = NaN, day = NaN] = datePart.split('-').map(Number);
    const timeParts = timePart.split(':');
    hour = Number(timeParts[0]);
    minute = Number(timeParts[1]);
  } else {
    [year = NaN, month = NaN, day = NaN] = datetimeString.split('-').map(Number);
    hour = 0;
    minute = 0;
  }

  const guess = new Date(Date.UTC(year, month - 1, day, hour, minute, 0, 0));

  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    // h23 keeps midnight as "00"; en-US with hour12:false reports it as "24",
    // which throws the offset math off by a full day when the guess lands on
    // midnight in the target zone (e.g. UTC).
    hourCycle: 'h23',
  });

  const parts = formatter.formatToParts(guess);
  const lookup = Object.fromEntries(parts.map((part) => [part.type, part.value]));

  const formattedYear = Number(lookup.year);
  const formattedMonth = Number(lookup.month);
  const formattedDay = Number(lookup.day);
  const formattedHour = Number(lookup.hour);
  const formattedMinute = Number(lookup.minute);

  const offsetMinutes =
    (Date.UTC(formattedYear, formattedMonth - 1, formattedDay, formattedHour, formattedMinute) -
      guess.getTime()) /
    60000;

  return new Date(guess.getTime() - offsetMinutes * 60_000);
}
