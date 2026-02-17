'use client';
import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import useVisibleItemCount from '@/hooks/useVisibleItemCount';
import { Calendar } from '@/components/ui/calendar';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import {
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  startOfDay,
  endOfDay,
  addMonths,
  subMonths,
} from 'date-fns';
import DayAssignmentsDialog from '@/components/dialogs/DayAssignmentsDialog';
import { DueDateModule } from '@/components/modules/DueDateModule';
import { useEffectiveTimezone } from '@/hooks/use-effective-timezone';
import { toEndOfDayInTimezone } from '@/lib/date-utils';
import { Button } from '@/components/ui/button';
import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react';

// Fetch assignments for courses the current user is enrolled in between given ISO start/end
async function fetchAssignmentsInRange(startIso: string, endIso: string) {
  const res = await fetch('/api/assignments/range', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ start: startIso, end: endIso }),
  });
  if (!res.ok) return [];
  return res.json();
}

function getDateKeyInTimeZone(date: Date | string, timeZone: string): string {
  const d = new Date(date);
  if (!Number.isFinite(d.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d);
  const lookup = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const year = lookup.year ?? '0000';
  const month = lookup.month ?? '01';
  const day = lookup.day ?? '01';
  return `${year}-${month}-${day}`;
}

export default function CalendarClient() {
  const { timezone } = useEffectiveTimezone();
  const [assignments, setAssignments] = useState<any[]>([]);
  const [selected, setSelected] = useState<Date | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [visibleStart, setVisibleStart] = useState<Date | null>(null);
  const [visibleEnd, setVisibleEnd] = useState<Date | null>(null);
  const [currentMonth, setCurrentMonth] = useState(new Date());

  // Dialog state
  const [dayDialogOpen, setDayDialogOpen] = useState(false);
  const [dialogDate, setDialogDate] = useState<Date | null>(null);
  const [dialogAssignments, setDialogAssignments] = useState<any[]>([]);

  const fetchForMonth = useCallback(
    async (month: Date) => {
      setLoading(true);
      const start = startOfWeek(startOfMonth(month));
      const end = endOfWeek(endOfMonth(month));

      // Expand to day range [00:00, 23:59:59.999]
      const startKey = getDateKeyInTimeZone(startOfDay(start), timezone);
      const endKey = getDateKeyInTimeZone(endOfDay(end), timezone);
      const startIso = toEndOfDayInTimezone(`${startKey}T00:00`, timezone).toISOString();
      const endIso = toEndOfDayInTimezone(`${endKey}T23:59`, timezone).toISOString();

      setVisibleStart(new Date(startIso));
      setVisibleEnd(new Date(endIso));

      const data = await fetchAssignmentsInRange(startIso, endIso);
      setAssignments(data);
      setLoading(false);
    },
    [timezone],
  );

  const openDayDialog = (date: Date, dayAssignments: any[]) => {
    setDialogDate(date);
    setDialogAssignments(dayAssignments);
    setDayDialogOpen(true);
  };

  const closeDayDialog = () => {
    setDayDialogOpen(false);
    setDialogDate(null);
    setDialogAssignments([]);
  };

  useEffect(() => {
    // initial month
    fetchForMonth(currentMonth);
  }, [fetchForMonth, currentMonth]);

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
    fetchForMonth(nextMonth);
  };

  const goToNextMonth = () => {
    const nextMonth = addMonths(currentMonth, 1);
    setCurrentMonth(nextMonth);
    fetchForMonth(nextMonth);
  };

  // Helper to get a YYYY-MM-DD key in the user's timezone
  const localDateKey = (date: Date | string) => getDateKeyInTimeZone(date, timezone);

  // Group assignments by date string (YYYY-MM-DD) using local dates
  const assignmentsByDate: Record<string, any[]> = {};
  assignments.forEach((a) => {
    const dateStr = localDateKey(a.dueDate);
    if (!assignmentsByDate[dateStr]) assignmentsByDate[dateStr] = [];
    assignmentsByDate[dateStr].push(a);
  });

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
          <CardTitle className="text-2xl">Calendar</CardTitle>
          <div className="w-8" aria-hidden="true" />
        </CardHeader>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_320px]">
        <Card className="flex h-full w-full flex-col">
          <CardContent className="flex min-h-0 flex-1 flex-col pt-6">
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
              <div className="w-56 px-4 text-center text-lg font-medium">{monthLabel}</div>
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
                  fetchForMonth(month);
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
                  day: 'relative w-full h-full p-0 text-center [&:first-child[data-selected=true]_button]:rounded-l-md [&:last-child[data-selected=true]_button]:rounded-r-md group/day aspect-square select-none border border-gray-300/60 dark:border-neutral-700',
                }}
                components={{
                  DayButton: (props: any) => {
                    const dateStr = localDateKey(props.day.date);
                    const dayAssignments = (assignmentsByDate[dateStr] || [])
                      .slice()
                      .sort(
                        (a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime(),
                      );

                    // Ref and state to compute how many of the first few assignment links fit without overflowing
                    const dayContentRef = useRef<HTMLDivElement | null>(null);
                    const visibleCount = useVisibleItemCount(dayContentRef, dayAssignments.length, {
                      conservativeMargin: 10,
                      sampleText: dayAssignments[0]?.title,
                    });

                    const todayDate = new Date();
                    const dayDate = props.day.date;
                    const isToday =
                      dayDate.getFullYear() === todayDate.getFullYear() &&
                      dayDate.getMonth() === todayDate.getMonth() &&
                      dayDate.getDate() === todayDate.getDate();
                    const isWeekend = dayDate.getDay() === 0 || dayDate.getDay() === 6;

                    return (
                      <div
                        role="button"
                        tabIndex={0}
                        aria-current={isToday ? 'date' : undefined}
                        onClick={(e) => {
                          const dayOnly = new Date(
                            props.day.date.getFullYear(),
                            props.day.date.getMonth(),
                            props.day.date.getDate(),
                          );
                          openDayDialog(dayOnly, dayAssignments);
                          props.onClick?.(e as any);
                        }}
                        onKeyDown={(e: any) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            const dayOnly = new Date(
                              props.day.date.getFullYear(),
                              props.day.date.getMonth(),
                              props.day.date.getDate(),
                            );
                            openDayDialog(dayOnly, dayAssignments);
                            props.onClick?.(e as any);
                          }
                        }}
                        className={cn(
                          'box-border grid min-h-0 w-full min-w-0 grid-rows-[auto_1fr] overflow-hidden',
                          isToday
                            ? 'bg-gray-200 dark:bg-neutral-800'
                            : 'bg-white dark:bg-neutral-900',
                          !isToday && isWeekend && 'dark:bg-neutral-850 bg-slate-50',
                        )}
                        style={{ aspectRatio: '1 / 1' }}
                      >
                        <span className="grid p-1 text-xs select-none">
                          {props.day.date.getDate()}
                        </span>
                        <div
                          ref={dayContentRef}
                          onClick={() =>
                            openDayDialog(
                              new Date(
                                props.day.date.getFullYear(),
                                props.day.date.getMonth(),
                                props.day.date.getDate(),
                              ),
                              dayAssignments,
                            )
                          }
                          className="grid min-h-0 w-full min-w-0 cursor-default content-start gap-1 overflow-hidden p-1"
                        >
                          {dayAssignments.slice(0, visibleCount).map((a: any) => (
                            <Link
                              key={a.id}
                              href={`/dashboard/courses/${a.courseId}/${a.id}`}
                              className={cn(
                                'assignment-link box-border block min-h-[1rem] w-full min-w-0 cursor-pointer truncate overflow-hidden rounded bg-sky-700 py-0.5 pl-1 text-left text-xs leading-tight whitespace-nowrap text-white hover:bg-sky-800 dark:bg-sky-600 dark:hover:bg-sky-700',
                                a.crossedOut && 'line-through opacity-80',
                              )}
                              title={`${a.course?.code ?? a.courseName ?? ''} - ${a.title}`}
                              onClick={(e: any) => e.stopPropagation()}
                            >
                              {`${a.course?.code ?? a.courseName ?? ''} - ${a.title}`}
                            </Link>
                          ))}
                          {dayAssignments.length > visibleCount && (
                            <div
                              aria-hidden={true}
                              className="h-2 w-2 self-center justify-self-center rounded-full bg-blue-500"
                            ></div>
                          )}
                        </div>
                      </div>
                    );
                  },
                }}
              />
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
