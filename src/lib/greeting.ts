/** The three greetings, and the hour each one starts at in the reader's own timezone. */
export type Greeting = 'Good morning' | 'Good afternoon' | 'Good evening';

/**
 * Which greeting the clock says, in a given timezone.
 *
 * Morning runs 05:00 to 11:59, afternoon 12:00 to 16:59, and evening takes everything else,
 * which is 17:00 through to 04:59 the next day. Evening is the fallback rather than a range of
 * its own precisely because it wraps midnight: written as `hour >= 17 && hour < 5` it is never
 * true, and that is the bug this function exists to not have.
 *
 * The timezone is not optional and there is no default, which is the other half of the point.
 * AFCT runs at five universities across four US timezones off one installation, so the server's
 * own clock is nobody's clock in particular: computing this from `new Date().getHours()` on a
 * UTC box tells a reader in California "good evening" over lunch. The caller has to say whose
 * morning it is.
 */
export function greetingFor(now: Date, timeZone: string): Greeting {
  const hour = hourIn(now, timeZone);
  if (hour >= 5 && hour < 12) return 'Good morning';
  if (hour >= 12 && hour < 17) return 'Good afternoon';
  return 'Good evening';
}

/**
 * The hour 0-23 in a timezone.
 *
 * `hourCycle: 'h23'` rather than `hour12: false`, which is not the same thing: the second one
 * formats midnight as "24" in several locales, and 24 is not less than 5, so every reader would
 * be greeted with "good evening" for the whole first hour of the day.
 *
 * An unknown timezone string makes Intl throw. That would take down a dashboard over a greeting,
 * so it falls back to UTC instead: the value comes from a user profile and a settings row, and
 * either could hold something stale after a tzdata change.
 */
function hourIn(now: Date, timeZone: string): number {
  try {
    return Number(
      new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', hourCycle: 'h23' }).format(now),
    );
  } catch {
    return now.getUTCHours();
  }
}
