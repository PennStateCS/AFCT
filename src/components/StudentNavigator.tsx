'use client';

import React, { useMemo, useRef, useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, ChevronDown } from 'lucide-react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from './ui/dropdown-menu';

import { formatDateTimeInTimeZone } from '@/lib/date';
import { useEffectiveTimezone } from '@/hooks/use-effective-timezone';
import { apiPaths } from '@/lib/api-paths';
import { queryKeys } from '@/lib/query-keys';
import { fetchJson } from '@/lib/query-fetch';

export type StudentNavigatorStudent = {
  id: string;
  firstName?: string | null;
  lastName?: string | null;
};

export type StudentNavigatorProps = {
  students: StudentNavigatorStudent[];
  selectedIndex: number;
  onSelectStudent: (studentId: string) => void;
  onPrev: () => void;
  onNext: () => void;
  gradeStatuses?: Record<string, boolean | undefined>;
  assignmentTotals?: { earned: number; available: number };
  courseId: string;
  assignmentId: string;
};

export default function StudentNavigator({
  students,
  selectedIndex,
  onSelectStudent,
  onPrev,
  onNext,
  gradeStatuses,
  assignmentTotals,
  courseId,
  assignmentId,
}: StudentNavigatorProps) {
  const { timezone } = useEffectiveTimezone();
  const [menuOpen, setMenuOpen] = useState(false);
  const [studentFilter, setStudentFilter] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Assignment shell: cached and shared with StudentAssignmentView via the same
  // key (queryKeys.assignment.shell), so the two dedupe/share this read.
  const assignmentQuery = useQuery<{
    dueDate?: string | Date;
    allowLateSubmissions?: boolean;
    lateCutoff?: string | Date | null;
  }>({
    queryKey: queryKeys.assignment.shell(courseId, assignmentId),
    queryFn: () =>
      fetchJson<{
        dueDate?: string | Date;
        allowLateSubmissions?: boolean;
        lateCutoff?: string | Date | null;
      }>(apiPaths.assignment(courseId, assignmentId, { view: 'problems' })),
    enabled: !!assignmentId,
    staleTime: 30_000,
  });

  const assignment = assignmentQuery.isError ? null : (assignmentQuery.data ?? null);
  // Only surface the loading label when a fetch is actually in flight; a disabled
  // query (no assignmentId) reports isPending but should render nothing here.
  const loadingAssignment = !!assignmentId && assignmentQuery.isPending;

  const selectedStudent = students[selectedIndex] ?? null;
  const selectedStatus = selectedStudent ? (gradeStatuses?.[selectedStudent.id] ?? false) : false;

  const formatPoints = (value: number) => {
    if (!Number.isFinite(value)) return 'Infinity';
    return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
  };

  const filteredStudents = useMemo(() => {
    const f = studentFilter.trim().toLowerCase();
    if (!f) return students;
    return students.filter((s) => {
      const full = `${s.firstName ?? ''} ${s.lastName ?? ''}`.toLowerCase();
      return (
        full.includes(f) ||
        (s.firstName ?? '').toLowerCase().includes(f) ||
        (s.lastName ?? '').toLowerCase().includes(f)
      );
    });
  }, [students, studentFilter]);

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

  const selectedName = selectedStudent
    ? `${selectedStudent.firstName ?? ''} ${selectedStudent.lastName ?? ''}`.trim() ||
      'Unnamed student'
    : null;

  return (
    <div className="flex w-full items-center justify-between gap-2">
      {/* Polite live region: announces the newly selected student on navigation,
          since focus stays on the Prev/Next/dropdown control while the panel changes. */}
      <span className="sr-only" aria-live="polite">
        {selectedName
          ? `Now reviewing ${selectedName}, student ${selectedIndex + 1} of ${students.length}. ${
              selectedStatus ? 'All problems graded.' : 'Missing grades.'
            }`
          : ''}
      </span>
      <div className="min-w-0">
        <span className="block">
          {loadingAssignment ? (
            <span className="text-muted-foreground text-sm">Loading assignment...</span>
          ) : assignment ? (
            <>
              <span>
                <span className="font-semibold">Due:</span>{' '}
                {assignment.dueDate ? formatDateTimeInTimeZone(assignment.dueDate, timezone) : '—'}
              </span>
              <span className="text-muted-foreground mx-2">•</span>
              <span>
                <span className="font-semibold">Allow Late:</span>{' '}
                {assignment.allowLateSubmissions ? 'Yes' : 'No'}
              </span>
              <span className="text-muted-foreground mx-2">•</span>
              <span>
                <span className="font-semibold">Late Cutoff:</span>{' '}
                {assignment.allowLateSubmissions && assignment.lateCutoff
                  ? formatDateTimeInTimeZone(assignment.lateCutoff, timezone)
                  : 'Never'}
              </span>
            </>
          ) : null}
        </span>
        <span className="block">
          Student {students.length === 0 ? 0 : selectedIndex + 1} of {students.length}
          {assignmentTotals ? (
            <span>
              <span className="text-muted-foreground mx-2">•</span>
              {formatPoints(assignmentTotals.earned)} / {formatPoints(assignmentTotals.available)}{' '}
              pts
            </span>
          ) : null}
        </span>
      </div>
      <div className="ml-auto flex items-center gap-2">
        <Button
          variant="secondary"
          onClick={onPrev}
          className="flex w-28 items-center justify-center gap-x-1"
        >
          <ChevronLeft className="h-4 w-4" /> Previous
        </Button>
        <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              className="bg-card text-foreground border-border hover:bg-input focus:ring-primary-300 flex w-[320px] items-center justify-between gap-2 border focus:ring-2 focus:ring-offset-1"
            >
              <span className="flex items-center gap-2 truncate">
                {selectedStudent ? (
                  <span
                    className={`h-2.5 w-2.5 rounded-full ${selectedStatus ? 'bg-green-500' : 'bg-red-500'}`}
                    aria-hidden="true"
                  />
                ) : null}
                <span className="truncate">
                  {selectedStudent ? (selectedName ?? 'Unnamed student') : 'Select student'}
                </span>
                {/* Text equivalent for the dot, announced when the trigger is focused. */}
                {selectedStudent ? (
                  <span className="sr-only">
                    {selectedStatus ? '(all problems graded)' : '(missing grades)'}
                  </span>
                ) : null}
              </span>
              <ChevronDown className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="bg-card text-foreground border-border w-[320px] rounded-md border p-2 shadow-lg">
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
                filteredStudents.map((s) => (
                  <DropdownMenuItem
                    key={s.id}
                    className="hover:bg-input"
                    onClick={() => handleSelect(s.id)}
                  >
                    <span className="flex items-center gap-2 truncate">
                      <span
                        className={`h-2.5 w-2.5 rounded-full ${gradeStatuses?.[s.id] ? 'bg-green-500' : 'bg-red-500'}`}
                        aria-hidden="true"
                      />
                      <span className="truncate">
                        {s.firstName} {s.lastName}
                      </span>
                      {/* Text equivalent for the color-coded dot (use of color). */}
                      <span className="sr-only">
                        {gradeStatuses?.[s.id] ? 'All problems graded' : 'Missing grades'}
                      </span>
                    </span>
                  </DropdownMenuItem>
                ))
              )}
            </div>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button
          variant="secondary"
          onClick={onNext}
          className="flex w-28 items-center justify-center gap-x-1"
        >
          Next <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
