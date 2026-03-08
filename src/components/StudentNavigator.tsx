'use client';

import { useMemo, useRef, useState, useEffect } from 'react';
import { ChevronLeft, ChevronRight, ChevronDown } from 'lucide-react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from './ui/dropdown-menu';

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
};

export default function StudentNavigator({
  students,
  selectedIndex,
  onSelectStudent,
  onPrev,
  onNext,
  gradeStatuses,
  assignmentTotals,
}: StudentNavigatorProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [studentFilter, setStudentFilter] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);

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

  return (
    <div className="flex items-center gap-2">
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
                  aria-label={selectedStatus ? 'All problems graded' : 'Missing grades'}
                />
              ) : null}
              <span className="truncate">
                {selectedStudent
                  ? `${selectedStudent.firstName ?? ''} ${selectedStudent.lastName ?? ''}`.trim() ||
                    'Unnamed student'
                  : 'Select student'}
              </span>
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
                if (filteredStudents.length > 0) {
                  handleSelect(filteredStudents[0].id);
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
      <span className="text-muted-foreground ml-2 text-sm">
        Student {students.length === 0 ? 0 : selectedIndex + 1} of {students.length}
      </span>
      {assignmentTotals ? (
        <span className="text-foreground flex items-center text-sm">
          <span className="text-muted-foreground mx-2">•</span>
          <span>
            {formatPoints(assignmentTotals.earned)} / {formatPoints(assignmentTotals.available)} pts
          </span>
        </span>
      ) : null}
    </div>
  );
}
