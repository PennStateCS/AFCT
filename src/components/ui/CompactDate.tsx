import { formatDateInTimeZone, formatTimeInTimeZone, parseValidDate } from '@/lib/date';

/**
 * A compact table-cell date: the date on top with the time in muted text below, so a
 * date column stays narrow instead of forcing one wide "MM/DD/YY HH:MM AM" line.
 * Renders "—" for a missing/invalid value.
 */
export function CompactDate({
  value,
  timeZone,
}: {
  value: Date | string | number | null | undefined;
  timeZone: string;
}) {
  const parsed = parseValidDate(value);
  if (!parsed) return <span className="text-muted-foreground">—</span>;
  return (
    <div className="leading-tight whitespace-nowrap">
      <div>{formatDateInTimeZone(parsed, timeZone)}</div>
      <div className="text-muted-foreground text-xs">{formatTimeInTimeZone(parsed, timeZone)}</div>
    </div>
  );
}
