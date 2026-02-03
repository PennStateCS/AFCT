'use client';
import { useEffect, useState, useCallback, useRef } from 'react';
import useVisibleItemCount from '@/hooks/useVisibleItemCount';
import { Calendar } from '@/components/ui/calendar';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { startOfMonth, endOfMonth, startOfWeek, endOfWeek, startOfDay, endOfDay } from 'date-fns';
import DayAssignmentsDialog from '@/components/dialogs/DayAssignmentsDialog';
import { useEffectiveTimezone } from '@/hooks/use-effective-timezone';

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

export default function CalendarPage() {
  const { timezone } = useEffectiveTimezone();
  const [assignments, setAssignments] = useState<any[]>([]);
  const [selected, setSelected] = useState<Date | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [visibleStart, setVisibleStart] = useState<Date | null>(null);
  const [visibleEnd, setVisibleEnd] = useState<Date | null>(null);

  // Dialog state
  const [dayDialogOpen, setDayDialogOpen] = useState(false);
  const [dialogDate, setDialogDate] = useState<Date | null>(null);
  const [dialogAssignments, setDialogAssignments] = useState<any[]>([]);

  const fetchForMonth = useCallback(async (month: Date) => {
    setLoading(true);
    const start = startOfWeek(startOfMonth(month));
    const end = endOfWeek(endOfMonth(month));

    // Expand to day range [00:00, 23:59:59.999]
    const startIso = startOfDay(start).toISOString();
    const endIso = endOfDay(end).toISOString();

    setVisibleStart(new Date(startIso));
    setVisibleEnd(new Date(endIso));

    const data = await fetchAssignmentsInRange(startIso, endIso);
    setAssignments(data);
    setLoading(false);
  }, []);

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
    fetchForMonth(new Date());
  }, [fetchForMonth]);

  // Helper to get a local YYYY-MM-DD key (avoids UTC toISOString timezone slips)
  const localDateKey = (date: Date | string) => {
    const d = new Date(date);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

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
    <div className="bg-background flex min-h-screen flex-col items-stretch justify-start overflow-hidden">
      <h1 className="p-4 text-2xl font-bold">Calendar</h1>
      <div
        className="bg-card flex w-full flex-1 flex-col rounded-lg border border-gray-200 p-4 shadow"
        style={{ boxSizing: 'border-box', minHeight: 480 }}
      >
        <div className="h-full w-full overflow-auto">
          <Calendar
            mode="single"
            selected={selected}
            onSelect={setSelected}
            onMonthChange={(month: Date) => fetchForMonth(month)}
            className="text-foreground bg-card h-full w-full"
            timeZone={timezone}
            components={{
              DayButton: (props: any) => {
                const dateStr = localDateKey(props.day.date);
                const dayAssignments = (assignmentsByDate[dateStr] || [])
                  .slice()
                  .sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime());

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
                      'box-border grid min-h-0 w-full min-w-0 grid-rows-[auto_1fr] overflow-hidden border border-gray-400/60',
                      isToday ? 'bg-gray-200 dark:bg-neutral-800' : 'bg-white dark:bg-neutral-900',
                      'dark:border-neutral-700',
                    )}
                    style={{ aspectRatio: '1 / 1' }}
                  >
                    <span className="grid p-1 text-xs select-none">{props.day.date.getDate()}</span>
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
