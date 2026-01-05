"use client"

import Link from 'next/link'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  date?: string | Date | null
  assignments: any[]
  onClose?: () => void
  onNavigate?: (date: Date) => void
}

export default function DayAssignmentsDialog({ open, onOpenChange, date, assignments, onClose, onNavigate }: Props) {
  // Use the provided `date` prop directly. If it's a string, fall back to `new Date(date)`.
  const parsedDate = date instanceof Date ? date : (date ? new Date(date) : undefined);

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
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose?.(); onOpenChange(o); }}>
      <DialogContent className="bg-card max-w-lg">
        <DialogHeader className="flex items-start justify-between gap-4">
          <div>
            <DialogTitle>{parsedDate ? `${parsedDate.toLocaleDateString()}` : 'Assignments'}</DialogTitle>
            {parsedDate && (
              <div className="text-sm text-muted-foreground">{parsedDate.toLocaleDateString(undefined, { weekday: 'long' })}</div>
            )}
            <DialogDescription className="truncate text-sm text-muted-foreground mt-1">{assignments.length} assignment{assignments.length !== 1 ? 's' : ''}</DialogDescription>
          </div>
        </DialogHeader>

        <div className="mt-2">
          {assignments.length === 0 ? (
            <p className="text-sm text-muted-foreground">No assignments for this day.</p>
          ) : (
            <ul className="space-y-2">
              {assignments.map((a: any) => (
                <li key={a.id}>
                  <Link
                    href={`/dashboard/courses/${a.courseId}/${a.id}`}
                    className="block w-full bg-sky-700 hover:bg-sky-800 dark:bg-sky-600 dark:hover:bg-sky-700 text-white rounded-md p-3 cursor-pointer"
                    title={`${a.course?.code ?? a.courseName ?? ''} - ${a.title}`}
                    onClick={() => { onClose?.(); }}
                  >
                    <div className="font-medium text-sm truncate">{a.course?.code ? `${a.course.code} - ${a.title}` : a.title}</div>
                    <div className="text-xs opacity-90">{a.course?.name ?? ''}</div>
                    <div className="text-xs opacity-80 mt-1">{new Date(a.dueDate).toLocaleString()}</div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>

        <DialogFooter className="grid grid-cols-2 items-center w-full gap-2">
          <div className="flex items-center gap-2">
            <Button size="sm" variant="default" onClick={handlePrev} aria-label="Previous day" disabled={!parsedDate}>
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <Button size="sm" variant="default" onClick={handleNext} aria-label="Next day" disabled={!parsedDate}>
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
          <div className="justify-self-end">
            <DialogClose asChild>
              <Button type="button" variant="secondary">Close</Button>
            </DialogClose>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}