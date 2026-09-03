import { formatDateInTimeZone, formatTimeInTimeZone, parseValidDate } from '@/lib/date-format';

/**
 * A compact table-cell date: the date on top with the time in muted text below, so a
 * date column stays narrow instead of forcing one wide "MM/DD/YY HH:MM AM" line.
 * Renders "—" for a missing/invalid value.
 */
export function CompactDate({
  value,
  timeZone,
  hour12 = true,
}: {
  value: Date | string | number | null | undefined;
  timeZone: string;
  /**
   * The installation's clock preference, which an admin sets in System Settings.
   *
   * Defaulted rather than required so a caller that has not got it yet still compiles, but
   * every table should pass it: this component draws the time in most of the app's date
   * columns, and it was showing 12-hour times to installations that had asked for 24.
   */
  hour12?: boolean;
}) {
  const parsed = parseValidDate(value);
  if (!parsed) return <span className="text-muted-foreground">—</span>;
  return (
    <div className="leading-tight tabular-nums whitespace-nowrap">
      <div>{formatDateInTimeZone(parsed, timeZone)}</div>
      <div className="text-muted-foreground text-xs">
        {formatTimeInTimeZone(parsed, timeZone, hour12)}
      </div>
    </div>
  );
}
