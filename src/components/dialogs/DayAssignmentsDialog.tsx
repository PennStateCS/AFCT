'use client';

import Link from 'next/link';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useEffectiveTimezone } from '@/hooks/use-effective-timezone';
import {
  formatDateInTimeZone,
  formatDateTimeInTimeZone,
  formatWeekdayInTimeZone,
} from '@/lib/date';
import type { CalendarAssignment } from '@/lib/calendar-shared';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  date?: string | Date | null;
  assignments: CalendarAssignment[];
  onClose?: () => void;
  onNavigate?: (date: Date) => void;
};

export default function DayAssignmentsDialog({
  open,
  onOpenChange,
  date,
  assignments,
  onClose,
  onNavigate,
}: Props) {
  // Use the provided `date` prop directly. If it's a string, fall back to `new Date(date)`.
  const parsedDate = date instanceof Date ? date : date ? new Date(date) : undefined;
  const { timezone } = useEffectiveTimezone();

  const handlePrev = () => {
    if (!parsedDate) return;
    const prev = new Date(parsedDate);
    prev.setDate(prev.getDate() - 1);
    onNavigate?.(prev);
  };

  const handleNext = () => {
    if (!parsedDate) return;
    const next = new Date(parsedDate);
    next.setDate(next.getDate() + 1);
    onNavigate?.(next);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose?.();
        onOpenChange(o);
      }}
    >
      <DialogContent
        className="bg-card max-w-lg"
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader className="flex items-start justify-between gap-4">
          <div>
            <DialogTitle>
              {parsedDate ? `${formatDateInTimeZone(parsedDate, timezone)}` : 'Assignments'}
            </DialogTitle>
            {parsedDate && (
              <div className="text-muted-foreground text-sm">
                {formatWeekdayInTimeZone(parsedDate, timezone)}
              </div>
            )}
            <DialogDescription className="text-muted-foreground mt-1 truncate text-sm">
              {assignments.length} assignment{assignments.length !== 1 ? 's' : ''}
            </DialogDescription>
          </div>
        </DialogHeader>

        <div className="mt-2">
          {assignments.length === 0 ? (
            <p className="text-muted-foreground text-sm">No assignments for this day.</p>
          ) : (
            <ul className="space-y-2">
              {assignments.map((a) => (
                <li key={a.id}>
                  <Link
                    href={`/dashboard/courses/${a.courseId}/${a.id}`}
                    className={cn(
                      'block w-full cursor-pointer rounded-md bg-sky-700 p-3 text-white hover:bg-sky-800 dark:bg-sky-600 dark:hover:bg-sky-700',
                      a.crossedOut && 'line-through opacity-80',
                    )}
                    title={`${a.course.code} - ${a.title}`}
                    onClick={() => {
                      onClose?.();
                    }}
                  >
                    <div className="truncate text-sm font-medium">
                      {`${a.course.code} - ${a.title}`}
                    </div>
                    <div className="text-xs opacity-90">{a.course.name}</div>
                    <div className="mt-1 text-xs opacity-80">
                      {formatDateTimeInTimeZone(a.dueDate, timezone)}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>

        <DialogFooter className="grid w-full grid-cols-2 items-center gap-2">
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="default"
              onClick={handlePrev}
              aria-label="Previous day"
              disabled={!parsedDate}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              size="sm"
              variant="default"
              onClick={handleNext}
              aria-label="Next day"
              disabled={!parsedDate}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
          <div className="justify-self-end">
            <DialogClose asChild>
              <Button type="button" variant="secondary">
                Close
              </Button>
            </DialogClose>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
