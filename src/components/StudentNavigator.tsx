'use client';

import React, { useMemo, useRef, useState, useEffect } from 'react';
import { ChevronDown } from 'lucide-react';
import { Button } from './ui/button';
import { SubmissionNavigator } from '@/components/assignments/SubmissionNavigator';
import { Input } from './ui/input';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from './ui/dropdown-menu';
import { Badge } from '@/components/ui/badge';
import { ENROLLMENT_STATUS_BADGE } from '@/lib/badge-presets';

export type StudentNavigatorStudent = {
  id: string;
  firstName?: string | null;
  lastName?: string | null;
  // 'DROPPED' badges the student as no longer enrolled (their work is still reviewable).
  enrollmentStatus?: string | null;
};

/** Small "Dropped" badge for a student who is no longer enrolled. */
function DroppedBadge() {
  return (
    <Badge variant={ENROLLMENT_STATUS_BADGE.DROPPED} className="shrink-0">
      Dropped
    </Badge>
  );
}

type EffectiveSchedule = {
  unlockAt: string | null;
  dueDate: string;
  lateCutoff: string | null;
  allowLateSubmissions: boolean;
  source: 'base' | 'student-override' | 'group-override';
};

type StudentGroupInfo = {
  /** Whether the ASSIGNMENT is a group assignment, regardless of this student's group. */
  isGroupAssignment?: boolean;
  /** Whether THIS student has a group to submit with. */
  isGroup: boolean;
  group: { id: string; name: string } | null;
  members: { id: string; firstName: string | null; lastName: string | null }[];
  effective?: EffectiveSchedule;
};

/**
 * How many students the menu will draw at once.
 *
 * Every row is a Radix menu item, so a thousand-student course mounted a thousand of them
 * every time the menu opened. Rather than pull in a virtualization library on a route that
 * has been deliberately slimmed, the list is capped and says so, and the search box narrows
 * it. Prev/Next still walk the entire roster, so nothing becomes unreachable.
 */
const MAX_VISIBLE_STUDENTS = 100;

/** "First Last" (falls back to "Student"). Used for prose, like the groupmates line. */
function memberName(m: { firstName?: string | null; lastName?: string | null }): string {
  return `${m.firstName ?? ''} ${m.lastName ?? ''}`.trim() || 'Student';
}

/**
 * "Last, First" for the picker, which is a list staff scan by surname the way a roster or
 * a gradebook reads. Falls back to whichever half exists rather than emitting a stray
 * comma, so a student with only one name recorded still shows something sensible.
 */
function listName(s: { firstName?: string | null; lastName?: string | null }): string {
  const first = (s.firstName ?? '').trim();
  const last = (s.lastName ?? '').trim();
  if (last && first) return `${last}, ${first}`;
  return last || first || 'Unnamed student';
}

export type StudentNavigatorProps = {
  students: StudentNavigatorStudent[];
  selectedIndex: number;
  onSelectStudent: (studentId: string) => void;
  onPrev: () => void;
  onNext: () => void;
  gradeStatuses?: Record<string, boolean | undefined>;
  /** Points each student has earned on this assignment, shown beside their name. */
  earnedByStudent?: Record<string, number | undefined>;
  /** What the assignment is out of, so the figure reads as a score rather than a count. */
  totalPoints?: number;
  /**
   * The selected student's group and effective schedule, from the review-data the parent
   * already fetched. This used to be a second per-student request from inside here, which
   * doubled the traffic of walking a roster for a payload the parent was fetching anyway.
   */
  groupInfo?: StudentGroupInfo | null;
};

export default function StudentNavigator({
  students,
  selectedIndex,
  onSelectStudent,
  onPrev,
  onNext,
  gradeStatuses,
  earnedByStudent,
  totalPoints,
  groupInfo = null,
}: StudentNavigatorProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [studentFilter, setStudentFilter] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);

  const selectedStudent = students[selectedIndex] ?? null;
  const selectedStatus = selectedStudent ? (gradeStatuses?.[selectedStudent.id] ?? false) : false;

  const filteredStudents = useMemo(() => {
    const f = studentFilter.trim().toLowerCase();
    if (!f) return students;
    return students.filter((s) => {
      // Match both orders, so typing what is on screen ("lovelace, ada") finds the row
      // just as readily as typing the name the natural way round.
      const full = `${s.firstName ?? ''} ${s.lastName ?? ''}`.toLowerCase();
      return (
        full.includes(f) ||
        listName(s).toLowerCase().includes(f) ||
        (s.firstName ?? '').toLowerCase().includes(f) ||
        (s.lastName ?? '').toLowerCase().includes(f)
      );
    });
  }, [students, studentFilter]);

  const visibleStudents = filteredStudents.slice(0, MAX_VISIBLE_STUDENTS);
  const hiddenStudentCount = filteredStudents.length - visibleStudents.length;

  useEffect(() => {
    if (menuOpen) {
      const id = setTimeout(() => inputRef.current?.focus(), 0);
      return () => clearTimeout(id);
    }
    return undefined;
  }, [menuOpen]);

  const handleSelect = (studentId: string) => {
    onSelectStudent(studentId);
    setStudentFilter('');
    setMenuOpen(false);
  };

  // The trigger matches the list it opens, so the name does not reorder as you pick it.
  const selectedName = selectedStudent ? listName(selectedStudent) : null;
  // Spoken announcements stay in natural order: "Now reviewing Lovelace, Ada" reads as a
  // filing-card entry rather than a sentence.
  const selectedSpokenName = selectedStudent ? memberName(selectedStudent) : null;

  return (
    <div className="flex w-full min-w-0 flex-col gap-1">
      {/* Polite live region: announces the newly selected student on navigation,
          since focus stays on the Prev/Next/dropdown control while the panel changes. */}
      <span className="sr-only" aria-live="polite">
        {selectedSpokenName
          ? `Now reviewing ${selectedSpokenName}, student ${selectedIndex + 1} of ${students.length}. ${
              selectedStatus ? 'All problems graded.' : 'Missing grades.'
            }`
          : ''}
      </span>
      <SubmissionNavigator
        label="Student"
        position={selectedStudent ? selectedIndex + 1 : null}
        total={students.length}
        onPrev={onPrev}
        onNext={onNext}
        prevLabel="Previous student"
        nextLabel="Next student"
        prevTitle="Previous student (Left arrow)"
        nextTitle="Next student (Right arrow)"
        keyShortcuts={['ArrowLeft', 'ArrowRight']}
      >
        <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              className="bg-card text-foreground border-border hover:bg-accent focus:ring-ring relative flex min-w-0 flex-1 items-center gap-2 rounded-none border-x-0 focus:z-10 focus:ring-2"
            >
              <span className="flex min-w-0 flex-1 items-center gap-2 truncate">
                {selectedStudent ? (
                  <span
                    className={`h-2.5 w-2.5 rounded-full ${selectedStatus ? 'bg-status-success-solid' : 'bg-status-danger-solid'}`}
                    aria-hidden="true"
                  />
                ) : null}
                <span className="truncate">
                  {selectedStudent ? (selectedName ?? 'Unnamed student') : 'Select student'}
                </span>
                {selectedStudent?.enrollmentStatus === 'DROPPED' ? <DroppedBadge /> : null}
                {/* Text equivalent for the dot, announced when the trigger is focused. */}
                {selectedStudent ? (
                  <span className="sr-only">
                    {selectedStatus ? '(all problems graded)' : '(missing grades)'}
                  </span>
                ) : null}
              </span>
              {/* The position is shown above the control, but it was part of this button's
                  accessible name before it moved, so it stays here for a reader. */}
              {selectedStudent ? (
                <span className="sr-only">
                  , {selectedIndex + 1} of {students.length}
                </span>
              ) : null}
              <ChevronDown className="h-4 w-4 shrink-0" />
            </Button>
          </DropdownMenuTrigger>
          {/* As wide as the control it belongs to, rather than a fixed 320px that was
              narrower than the trigger on a desktop and wider than the screen on a phone.
              Radix publishes the trigger's width as a CSS variable for exactly this. */}
          <DropdownMenuContent className="bg-card text-foreground border-border w-[var(--radix-dropdown-menu-trigger-width)] min-w-56 rounded-md border p-2 shadow-lg">
            <Input
              ref={inputRef}
              placeholder="Search students..."
              value={studentFilter}
              onChange={(e) => setStudentFilter(e.target.value)}
              className="bg-card border-input mb-2"
              aria-label="Search students by name"
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter') {
                  e.preventDefault();
                  const firstMatch = filteredStudents[0];
                  if (firstMatch) {
                    handleSelect(firstMatch.id);
                  }
                  return;
                }
                if (e.key === 'Escape') {
                  setStudentFilter('');
                }
              }}
            />
            <div className="max-h-64 overflow-auto">
              {filteredStudents.length === 0 ? (
                <div className="text-muted-foreground p-2 text-sm">No students found</div>
              ) : (
                visibleStudents.map((s) => (
                  <DropdownMenuItem
                    key={s.id}
                    className="hover:bg-accent"
                    onClick={() => handleSelect(s.id)}
                  >
                    {/* Full width, or ml-auto on the score below has nothing to push against
                        and the figures never line up. */}
                    <span className="flex w-full items-center gap-2">
                      {/* Filled when fully graded, hollow when not: a shape difference as well
                          as a colour one, matching the problem picker. */}
                      <span
                        className={`h-2.5 w-2.5 shrink-0 rounded-full border-2 ${
                          gradeStatuses?.[s.id]
                            ? 'border-status-success-solid bg-status-success-solid'
                            : 'border-status-danger-solid bg-transparent'
                        }`}
                        aria-hidden="true"
                      />
                      <span className="truncate">{listName(s)}</span>
                      {s.enrollmentStatus === 'DROPPED' ? <DroppedBadge /> : null}
                      {/* Their standing on this assignment, the way the problem picker shows
                          each problem's. A dash reads as ungraded without relying on the dot's
                          colour. */}
                      {typeof totalPoints === 'number' ? (
                        <span className="text-muted-foreground ml-auto shrink-0 text-xs tabular-nums">
                          {gradeStatuses?.[s.id] || (earnedByStudent?.[s.id] ?? 0) > 0
                            ? (earnedByStudent?.[s.id] ?? 0)
                            : '—'}
                          /{totalPoints}
                        </span>
                      ) : null}
                      {/* Text equivalent for the color-coded dot (use of color). */}
                      <span className="sr-only">
                        {gradeStatuses?.[s.id] ? 'All problems graded' : 'Missing grades'}
                      </span>
                    </span>
                  </DropdownMenuItem>
                ))
              )}
              {/* Never truncate silently: a grader who cannot see a name needs to know the
                  list is capped rather than conclude the student is not enrolled. */}
              {hiddenStudentCount > 0 ? (
                <div className="text-muted-foreground border-t p-2 text-xs">
                  Showing the first {MAX_VISIBLE_STUDENTS} of {filteredStudents.length}. Type a name
                  to narrow the list.
                </div>
              ) : null}
            </div>
          </DropdownMenuContent>
        </DropdownMenu>
      </SubmissionNavigator>
      <div className="min-w-0">
        {/* A group assignment with nobody to submit alongside is a setup mistake, not a
            fact about this student's work. Say so here rather than letting the panel read
            as a normal individual submission. */}
        {groupInfo?.isGroupAssignment && !groupInfo.isGroup ? (
          <span className="text-status-warning block text-xs font-medium">
            Not in a group. Their work below is their own; add them to a group to review it with the
            rest.
          </span>
        ) : null}
      </div>
    </div>
  );
}
