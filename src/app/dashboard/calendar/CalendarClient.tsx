'use client';
import React from 'react';
import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import type { CalendarDay, Modifiers } from 'react-day-picker';
import { useQuery } from '@tanstack/react-query';
import { Calendar } from '@/components/ui/calendar';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { addMonths, subMonths } from 'date-fns';
import DayAssignmentsDialog from '@/components/dialogs/DayAssignmentsDialog';
import { DueDateModule } from '@/components/modules/DueDateModule';
import { useEffectiveTimezone } from '@/hooks/use-effective-timezone';
import { Button } from '@/components/ui/button';
import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react';
import type { CalendarAssignment } from '@/lib/calendar-shared';
import { getDateKeyInTimeZone, getMonthRangeIso } from '@/lib/calendar-shared';
import { apiPaths } from '@/lib/api-paths';

// Fetch assignments for courses the current user is enrolled in between given ISO start/end
async function fetchAssignmentsInRange(startIso: string, endIso: string, signal?: AbortSignal) {
  const res = await fetch(apiPaths.myAssignments(), {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ start: startIso, end: endIso }),
    signal,
  });
  if (!res.ok) throw new Error('Failed to fetch assignments');
  return (await res.json()) as Promise<CalendarAssignment[]>;
}

// Per-day data the custom DayButton needs, delivered by context so the component
// itself can live at module scope with a stable identity (see CalendarDayButton).
type CalendarDayContextValue = {
  assignmentsByDate: Record<string, CalendarAssignment[]>;
  timezone: string;
  visibleAssignmentLimit: number;
  localDateKey: (date: Date | string) => string;
  openDayDialog: (date: Date, dayAssignments: CalendarAssignment[]) => void;
};

const CalendarDayContext = React.createContext<CalendarDayContextValue | null>(null);

type DayButtonProps = {
  day: CalendarDay;
  modifiers: Modifiers;
} & React.ButtonHTMLAttributes<HTMLButtonElement>;

/**
 * The calendar's day cell. Defined at module scope — NOT inline in the `components`
 * prop — so its component identity is stable across CalendarClient renders. An inline
 * definition would be a new component type every render, which makes react-day-picker
 * unmount and remount every day cell on each render (dropping focus and re-running the
 * roving-focus effect). The per-render data comes through CalendarDayContext instead.
 */
function CalendarDayButton(props: DayButtonProps) {
  const ctx = React.useContext(CalendarDayContext);
  if (!ctx) {
    throw new Error('CalendarDayButton must be rendered within a CalendarDayContext provider');
  }
  const { assignmentsByDate, timezone, visibleAssignmentLimit, localDateKey, openDayDialog } = ctx;

  const {
    day,
    modifiers,
    onClick: rdpOnClick,
    onKeyDown: rdpOnKeyDown,
    onFocus: rdpOnFocus,
    onBlur: rdpOnBlur,
    tabIndex: rdpTabIndex,
  } = props;
  // react-day-picker owns keyboard navigation: it hands each day a
  // roving tabIndex (only the active day is 0), an arrow-key onKeyDown,
  // and it flags the day to focus via modifiers.focused. Forward all of
  // that so the grid is one tab stop with working arrow keys, instead of
  // ~40 tab stops and dead arrows.
  const dayRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (modifiers.focused) dayRef.current?.focus();
  }, [modifiers.focused]);
  const dateStr = localDateKey(day.date);
  const dayAssignments = (assignmentsByDate[dateStr] || [])
    .slice()
    .sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime());

  const visibleCount = visibleAssignmentLimit;

  const todayDate = new Date();
  const dayDate = day.date;
  const isToday =
    dayDate.getFullYear() === todayDate.getFullYear() &&
    dayDate.getMonth() === todayDate.getMonth() &&
    dayDate.getDate() === todayDate.getDate();
  const isWeekend = dayDate.getDay() === 0 || dayDate.getDay() === 6;
  const hiddenAssignmentCount = Math.max(0, dayAssignments.length - visibleCount);
  const formattedDayLabel = new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: timezone,
  }).format(dayDate);
  const openCurrentDay = () => {
    const dayOnly = new Date(day.date.getFullYear(), day.date.getMonth(), day.date.getDate());
    openDayDialog(dayOnly, dayAssignments);
  };

  return (
    <div
      ref={dayRef}
      role="button"
      tabIndex={rdpTabIndex ?? -1}
      aria-current={isToday ? 'date' : undefined}
      aria-keyshortcuts="Enter Space"
      aria-label={`${formattedDayLabel}${isToday ? ', today' : ''}. ${dayAssignments.length} assignment${dayAssignments.length === 1 ? '' : 's'}. Press Enter to open assignments for this day.`}
      onFocus={rdpOnFocus as React.FocusEventHandler<HTMLDivElement> | undefined}
      onBlur={rdpOnBlur as React.FocusEventHandler<HTMLDivElement> | undefined}
      onClick={(e) => {
        openCurrentDay();
        rdpOnClick?.(e as unknown as React.MouseEvent<HTMLButtonElement>);
      }}
      onKeyDown={(e: React.KeyboardEvent<HTMLDivElement>) => {
        // Let react-day-picker handle arrow/Home/End/PageUp/Down navigation first.
        rdpOnKeyDown?.(e as unknown as React.KeyboardEvent<HTMLButtonElement>);

        // Do not hijack keyboard events from nested interactive elements (e.g., assignment links).
        if (e.target !== e.currentTarget) return;

        if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
          e.preventDefault();
          openCurrentDay();
          rdpOnClick?.(e as unknown as React.MouseEvent<HTMLButtonElement>);
        }
      }}
      className={cn(
        'box-border grid min-h-0 w-full min-w-0 grid-rows-[auto_1fr] overflow-hidden focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-1 focus-visible:outline-none',
        isToday
          ? 'bg-sky-100 ring-2 ring-sky-500 ring-inset dark:bg-sky-950/60 dark:ring-sky-400'
          : 'bg-white dark:bg-neutral-900',
        !isToday && isWeekend && 'bg-slate-50 dark:bg-neutral-800',
      )}
      style={{ aspectRatio: '1 / 1' }}
    >
      <span
        className={cn(
          'self-start justify-self-start p-1 text-left text-xs select-none',
          isToday && 'rounded bg-sky-600 px-1.5 py-0.5 font-semibold text-white dark:bg-sky-500',
        )}
      >
        {day.date.getDate()}
      </span>
      <div
        onClick={() => openCurrentDay()}
        className="grid min-h-0 w-full min-w-0 cursor-default content-start gap-1 overflow-hidden p-1"
      >
        {dayAssignments.slice(0, visibleCount).map((a) => {
          const isDraft = a.isPublished === false;
          return (
            <Link
              key={a.id}
              href={`/dashboard/courses/${a.courseId}/${a.id}`}
              // Kept out of the tab sequence so the calendar grid stays a
              // single roving tab stop (arrow keys move between days). These
              // chips are still clickable, and keyboard users reach the same
              // links via the day dialog (Enter) and the Upcoming list.
              tabIndex={-1}
              className={cn(
                'assignment-link box-border block min-h-[1rem] w-full min-w-0 cursor-pointer truncate overflow-hidden rounded py-0.5 pl-1 text-left text-xs leading-tight whitespace-nowrap text-white',
                isDraft
                  ? 'bg-amber-600 hover:bg-amber-700 dark:bg-amber-600 dark:hover:bg-amber-700'
                  : 'bg-sky-700 hover:bg-sky-800 dark:bg-sky-600 dark:hover:bg-sky-700',
                a.crossedOut && 'line-through opacity-80',
              )}
              title={`${isDraft ? 'Draft — ' : ''}${a.course.code} - ${a.title}`}
              onClick={(e) => e.stopPropagation()}
            >
              {isDraft && <span aria-hidden="true">✎ </span>}
              {`${a.course.code} - ${a.title}`}
              {isDraft && <span className="sr-only"> (draft)</span>}
            </Link>
          );
        })}
        {dayAssignments.length > visibleCount && (
          <>
            <div
              aria-hidden={true}
              className="h-2 w-2 self-center justify-self-center rounded-full bg-blue-500"
            ></div>
            <span className="sr-only">
              {`${hiddenAssignmentCount} more assignment${hiddenAssignmentCount === 1 ? '' : 's'} not shown in cell. Open day to view all assignments.`}
            </span>
          </>
        )}
      </div>
    </div>
  );
}

// Stable `components` object for react-day-picker (module scope so its identity
// never changes between renders).
const CALENDAR_DAY_COMPONENTS = { DayButton: CalendarDayButton };

export default function CalendarClient({
  initialAssignments,
  initialMonth,
}: {
  initialAssignments?: CalendarAssignment[];
  initialMonth?: string;
}) {
  const { timezone } = useEffectiveTimezone();
  const [selected, setSelected] = useState<Date | undefined>(undefined);
  const [currentMonth, setCurrentMonth] = useState(
    initialMonth ? new Date(initialMonth) : new Date(),
  );
  const [visibleAssignmentLimit, setVisibleAssignmentLimit] = useState(2);

  // Dialog state
  const [dayDialogOpen, setDayDialogOpen] = useState(false);
  const [dialogDate, setDialogDate] = useState<Date | null>(null);
  const [dialogAssignments, setDialogAssignments] = useState<CalendarAssignment[]>([]);

  // ISO range for the visible month, in the user's timezone. This drives the cache
  // key, so each month is fetched once and served warm on revisit / back-and-forth
  // month navigation (no refetch within the staleTime window).
  const { startIso, endIso } = useMemo(
    () => getMonthRangeIso(currentMonth, timezone),
    [currentMonth, timezone],
  );

  // The SSR-provided range, captured once, so `initialAssignments` seed only the
  // month they belong to, not every month the user later navigates to.
  const [initialRange] = useState(() =>
    getMonthRangeIso(initialMonth ? new Date(initialMonth) : new Date(), timezone),
  );
  const isInitialRange = startIso === initialRange.startIso && endIso === initialRange.endIso;

  const {
    data: assignments = [],
    isFetching: loading,
    isError,
    refetch,
  } = useQuery({
    queryKey: ['assignments', 'range', startIso, endIso],
    queryFn: ({ signal }) => fetchAssignmentsInRange(startIso, endIso, signal),
    initialData:
      isInitialRange && Array.isArray(initialAssignments) ? initialAssignments : undefined,
    staleTime: 30_000,
  });

  const refresh = useCallback(() => {
    void refetch();
  }, [refetch]);

  const openDayDialog = useCallback((date: Date, dayAssignments: CalendarAssignment[]) => {
    setDialogDate(date);
    setDialogAssignments(dayAssignments);
    setDayDialogOpen(true);
  }, []);

  const closeDayDialog = () => {
    setDayDialogOpen(false);
    setDialogDate(null);
    setDialogAssignments([]);
  };

  useEffect(() => {
    const updateLimit = () => {
      const width = window.innerWidth;
      if (width < 768) {
        setVisibleAssignmentLimit(1);
      } else if (width < 1280) {
        setVisibleAssignmentLimit(2);
      } else {
        setVisibleAssignmentLimit(3);
      }
    };

    updateLimit();
    window.addEventListener('resize', updateLimit);
    return () => window.removeEventListener('resize', updateLimit);
  }, []);

  const monthLabel = useMemo(() => {
    return new Intl.DateTimeFormat('en-US', {
      month: 'long',
      year: 'numeric',
      timeZone: timezone,
    }).format(currentMonth);
  }, [currentMonth, timezone]);

  const goToPreviousMonth = () => {
    const nextMonth = subMonths(currentMonth, 1);
    setCurrentMonth(nextMonth);
  };

  const goToNextMonth = () => {
    const nextMonth = addMonths(currentMonth, 1);
    setCurrentMonth(nextMonth);
  };

  // Helper to get a YYYY-MM-DD key in the user's timezone
  const localDateKey = useCallback(
    (date: Date | string) => getDateKeyInTimeZone(date, timezone),
    [timezone],
  );

  // Group assignments by date string (YYYY-MM-DD) using local dates.
  const assignmentsByDate = useMemo(() => {
    const grouped: Record<string, CalendarAssignment[]> = {};
    assignments.forEach((a) => {
      const dateStr = localDateKey(a.dueDate);
      if (!grouped[dateStr]) grouped[dateStr] = [];
      grouped[dateStr].push(a);
    });
    return grouped;
  }, [assignments, localDateKey]);

  // The data the (module-scope) day cells read via context. Memoized so cells only
  // re-render when the data actually changes, never just because the parent did.
  const dayContextValue = useMemo<CalendarDayContextValue>(
    () => ({ assignmentsByDate, timezone, visibleAssignmentLimit, localDateKey, openDayDialog }),
    [assignmentsByDate, timezone, visibleAssignmentLimit, localDateKey, openDayDialog],
  );

  // Navigate to a different day in the dialog (previous/next)
  const navigateDay = (date: Date) => {
    const key = localDateKey(date);
    const dayAssignments = assignmentsByDate[key] || [];
    setDialogDate(date);
    setDialogAssignments(dayAssignments);
    setDayDialogOpen(true);
  };

  return (
    <div className="space-y-4 pb-8">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle role="heading" aria-level={1} className="text-2xl">
            Calendar
          </CardTitle>
          <div className="w-8" aria-hidden="true" />
        </CardHeader>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_320px]">
        <Card className="flex h-full w-full flex-col">
          <CardContent className="relative flex min-h-0 flex-1 flex-col pt-6">
            {isError ? (
              <div className="mb-3 flex items-center justify-between gap-3 rounded-md border border-red-300 bg-red-50 px-3 py-2">
                <p role="alert" className="text-sm text-red-700">
                  Failed to load calendar assignments. Please try again.
                </p>
                <Button variant="outline" size="sm" onClick={refresh}>
                  Retry
                </Button>
              </div>
            ) : null}
            {loading ? (
              <div
                role="status"
                className="pointer-events-none absolute top-3 right-3 z-10 rounded-md border border-slate-200 bg-white/90 px-2 py-1 shadow-sm backdrop-blur-sm dark:border-neutral-700 dark:bg-neutral-900/90"
              >
                <p className="text-muted-foreground text-xs italic">Loading assignments...</p>
              </div>
            ) : null}
            <div className="mx-auto mb-2 flex w-full max-w-6xl items-center justify-center gap-2 px-2">
              <Button
                type="button"
                variant="default"
                size="sm"
                className="h-8 w-8 p-0"
                onClick={goToPreviousMonth}
                aria-label="Previous month"
              >
                <ChevronLeftIcon className="h-4 w-4" />
              </Button>
              <div
                aria-live="polite"
                aria-atomic="true"
                className="w-56 px-4 text-center text-lg font-medium"
              >
                {monthLabel}
              </div>
              <Button
                type="button"
                variant="default"
                size="sm"
                className="h-8 w-8 p-0"
                onClick={goToNextMonth}
                aria-label="Next month"
              >
                <ChevronRightIcon className="h-4 w-4" />
              </Button>
            </div>
            <div className="h-full w-full overflow-auto">
              <p id="calendar-keyboard-help" className="sr-only">
                Use arrow keys to move between calendar days. Press Enter or Space to open
                assignments for the focused day.
              </p>
              <div aria-describedby="calendar-keyboard-help">
                <CalendarDayContext.Provider value={dayContextValue}>
                  <Calendar
                    mode="single"
                    selected={selected}
                    onSelect={setSelected}
                    formatters={{
                      formatWeekdayName: (date) =>
                        new Intl.DateTimeFormat('en-US', {
                          weekday: 'short',
                          timeZone: timezone,
                        }).format(date),
                    }}
                    month={currentMonth}
                    onMonthChange={(month: Date) => {
                      setCurrentMonth(month);
                    }}
                    className="text-foreground bg-card mx-auto h-full w-full max-w-6xl [--cell-size:3.25rem] sm:[--cell-size:3.5rem]"
                    timeZone={timezone}
                    classNames={{
                      nav: 'hidden',
                      month_caption: 'hidden',
                      caption_label: 'hidden',
                      dropdowns: 'hidden',
                      weekday:
                        'text-muted-foreground rounded-md flex-1 font-semibold text-[0.8rem] select-none text-center',
                      day: 'relative box-border -m-px w-full h-full p-0 text-center [&:first-child[data-selected=true]_button]:rounded-l-md [&:last-child[data-selected=true]_button]:rounded-r-md group/day aspect-square select-none border border-gray-300/60 dark:border-neutral-700',
                      today: 'rounded-none bg-transparent text-inherit',
                    }}
                    components={CALENDAR_DAY_COMPONENTS}
                  />
                </CalendarDayContext.Provider>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="w-full">
          <DueDateModule assignments={assignments} />
        </div>
      </div>
      <DayAssignmentsDialog
        open={dayDialogOpen}
        onOpenChange={(open) => {
          if (!open) closeDayDialog();
          setDayDialogOpen(open);
        }}
        date={dialogDate}
        assignments={dialogAssignments}
        onClose={closeDayDialog}
        onNavigate={navigateDay}
      />
    </div>
  );
}
