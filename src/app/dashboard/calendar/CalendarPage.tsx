"use client";
import { useEffect, useState, useCallback } from "react";
import { Calendar } from "@/components/ui/calendar";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { startOfMonth, endOfMonth, startOfWeek, endOfWeek, startOfDay, endOfDay } from 'date-fns';
import DayAssignmentsDialog from '@/components/dialogs/DayAssignmentsDialog';

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
  assignments.forEach(a => {
    const dateStr = localDateKey(a.dueDate);
    if (!assignmentsByDate[dateStr]) assignmentsByDate[dateStr] = [];
    assignmentsByDate[dateStr].push(a);
  });

  return (
    <div className="flex flex-col items-center justify-start min-h-screen overflow-hidden bg-white">
      <h1 className="text-2xl font-bold p-4">Calendar</h1>
      <div className="w-full max-w-6xl border border-gray-200 rounded-lg shadow bg-white flex flex-col items-center p-4 flex-1" style={{ boxSizing: 'border-box', minHeight: 480 }}>
        <div className="w-full h-full overflow-auto">
          <Calendar
            mode="single"
            selected={selected}
            onSelect={setSelected}
            onMonthChange={(month: Date) => fetchForMonth(month)}
            className="w-full h-full text-black"
            components={{
              DayButton: (props: any) => {
                const dateStr = localDateKey(props.day.date);
                const dayAssignments = (assignmentsByDate[dateStr] || [])
                  .slice()
                  .sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime())
                return (
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={(e) => {
                      const dayOnly = new Date(props.day.date.getFullYear(), props.day.date.getMonth(), props.day.date.getDate());
                      openDayDialog(dayOnly, dayAssignments);
                      props.onClick?.(e as any);
                    }}
                    onKeyDown={(e:any) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        const dayOnly = new Date(props.day.date.getFullYear(), props.day.date.getMonth(), props.day.date.getDate());
                        openDayDialog(dayOnly, dayAssignments);
                        props.onClick?.(e as any);
                      }
                    }}
                    className="w-full grid grid-rows-[auto_1fr] min-w-0 min-h-0 border border-gray-400/60 bg-white dark:bg-neutral-900 dark:border-neutral-700 overflow-hidden box-border"
                    style={{ aspectRatio: '1 / 1' }}
                  >
                    <span className="grid p-1 select-none">{props.day.date.getDate()}</span>
                    <div onClick={() => openDayDialog(new Date(props.day.date.getFullYear(), props.day.date.getMonth(), props.day.date.getDate()), dayAssignments)} className="grid content-start gap-1 w-full p-1 overflow-hidden min-h-0 min-w-0 cursor-default">
                      {dayAssignments.slice(0, 3).map((a: any) => (
                        <Link
                          key={a.id}
                          href={`/dashboard/courses/${a.courseId}/assignments/${a.id}`}
                          className="block w-full min-w-0 box-border bg-sky-700 hover:bg-sky-800 dark:bg-sky-600 dark:hover:bg-sky-700 text-left text-white text-xs rounded py-0.5 pl-1 truncate whitespace-nowrap overflow-hidden leading-tight cursor-pointer"
                          title={`${a.course?.code ?? a.courseName ?? ''} - ${a.title}`}
                          onClick={(e:any) => e.stopPropagation()}
                        >
                          {`${a.course?.code ?? a.courseName ?? ''} - ${a.title}`}
                        </Link>
                      ))}
                      {dayAssignments.length > 3 && (
                        <div className="w-2 h-2 bg-blue-500 rounded-full justify-self-start"></div>
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
        onOpenChange={(open) => { if (!open) closeDayDialog(); setDayDialogOpen(open); }}
        date={dialogDate}
        assignments={dialogAssignments}
        onClose={closeDayDialog}
      />
    </div>
  );
}
