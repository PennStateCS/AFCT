'use client';

import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { DataTable } from '@/components/ui/data-table';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { ColumnDef } from '@tanstack/react-table';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { showToast } from '@/lib/toast';
import { Table, RefreshCw } from 'lucide-react';
import { useEffectiveTimezone } from '@/hooks/use-effective-timezone';
import { formatTimeInTimeZone } from '@/lib/date';

type StudentRow = {
  id: string;
  name: string;
  email?: string | null;
  // dynamic assignment columns will be string keyed
  [key: string]: unknown;
};

type Assignment = {
  id: string;
  title: string;
  dueDate?: string;
  maxPoints?: number;
};

type ApiStudent = {
  id: string;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  avatar?: string | null;
};

export default function GradesCard({ courseId }: { courseId: string }) {
  const VISIBILITY_REFRESH_MS = 60_000;
  const { timezone } = useEffectiveTimezone();
  const [loading, setLoading] = useState(true);
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [editingCell, setEditingCell] = useState<{
    studentId: string;
    assignmentId: string;
  } | null>(null);
  const [editingValue, setEditingValue] = useState<string>('');
  const [savingGrades, setSavingGrades] = useState<Set<string>>(new Set());
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const inFlightRef = useRef(false);
  const lastFetchAtRef = useRef(0);

  const fetchGrades = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setLoading(true);
    try {
      const res = await fetch(`/api/courses/${courseId}/grades`);
      if (!res.ok) throw new Error((await res.json())?.error || 'Failed to load grades');
      const body = await res.json();

      const {
        students: s,
        assignments: a,
        grades,
      } = body as {
        students: ApiStudent[];
        assignments: Assignment[];
        grades: Record<string, Record<string, number | null>>;
      };

      const assignmentsWithPoints: Assignment[] = await Promise.all(
        a.map(async (asg) => {
          try {
            const res2 = await fetch(`/api/assignments/${asg.id}`);
            if (!res2.ok) return { ...asg, maxPoints: 0 };
            const json = await res2.json();
            return { ...asg, maxPoints: json.maxPoints ?? 0 };
          } catch {
            return { ...asg, maxPoints: 0 };
          }
        }),
      );

      // Build rows
      const rows: StudentRow[] = s.map((stu) => {
        const name =
          [stu.firstName, stu.lastName].filter(Boolean).join(' ') || stu.email || 'Unknown';
        const row: StudentRow = {
          id: stu.id,
          name,
          email: stu.email,
          avatar: stu.avatar ?? null,
          firstName: stu.firstName ?? '',
          lastName: stu.lastName ?? '',
        };
        for (const asg of a) {
          const grade = grades?.[stu.id]?.[asg.id];
          row[asg.id] = grade ?? null;
        }
        return row;
      });

      setStudents(rows);
      setAssignments(assignmentsWithPoints);
      setLastUpdated(new Date());
      lastFetchAtRef.current = Date.now();
    } catch (err) {
      console.error('Fetch grades error:', err);
      showToast.error('Failed to load grades');
    } finally {
      setLoading(false);
      inFlightRef.current = false;
    }
  }, [courseId]);

  useEffect(() => {
    fetchGrades();
  }, [fetchGrades]);

  // Add a mechanism to refresh data when component becomes visible
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        const now = Date.now();
        if (now - lastFetchAtRef.current < VISIBILITY_REFRESH_MS) {
          return;
        }
        // Page became visible and data is stale, refresh data.
        fetchGrades();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [fetchGrades]);

  const handleGradeEdit = useCallback(
    (studentId: string, assignmentId: string, currentValue: unknown) => {
      setEditingCell({ studentId, assignmentId });
      setEditingValue(
        currentValue === null || currentValue === undefined ? '' : String(currentValue),
      );
    },
    [],
  );

  const handleGradeSave = useCallback(
    async (studentId: string, assignmentId: string, assignmentMaxGrade: number) => {
      const gradeKey = `${studentId}-${assignmentId}`;
      setSavingGrades((prev) => new Set(prev).add(gradeKey));

      try {
        // Validate grade
        const numericValue = editingValue.trim() === '' ? null : Number(editingValue);
        if (
          numericValue !== null &&
          (isNaN(numericValue) || numericValue < 0 || numericValue > assignmentMaxGrade)
        ) {
          showToast.error(`Grade must be a number between 0 and ${assignmentMaxGrade}`);
          // cleanup saving flag
          setSavingGrades((prev) => {
            const newSet = new Set(prev);
            newSet.delete(gradeKey);
            return newSet;
          });
          return;
        }

        // Save to API
        const res = await fetch(`/api/courses/${courseId}/${assignmentId}/grade/${studentId}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ grade: numericValue }),
        });

        if (!res.ok) {
          const error = await res.json().catch(() => ({}));
          throw new Error(error?.error || 'Failed to save grade');
        }

        // Update local state
        setStudents((prev) =>
          prev.map((student) =>
            student.id === studentId ? { ...student, [assignmentId]: numericValue } : student,
          ),
        );

        // Get student name for toast
        const student = students.find((s) => s.id === studentId);
        const assignment = assignments.find((a) => a.id === assignmentId);
        const studentName = student ? student.name : 'Student';
        const assignmentTitle = assignment ? assignment.title : 'Assignment';

        showToast.success(
          `Grade ${numericValue ?? 'cleared'} saved for ${studentName} - ${assignmentTitle}`,
        );
        setEditingCell(null);
        setEditingValue('');
      } catch (error) {
        console.error('Grade save error:', error);
        showToast.error(error instanceof Error ? error.message : 'Failed to save grade');
      } finally {
        setSavingGrades((prev) => {
          const newSet = new Set(prev);
          newSet.delete(gradeKey);
          return newSet;
        });
      }
    },
    [courseId, students, assignments, editingValue],
  );

  const handleGradeCancel = useCallback(() => {
    setEditingCell(null);
    setEditingValue('');
  }, []);

  const columns = useMemo<ColumnDef<StudentRow, unknown>[]>(() => {
    const cols: ColumnDef<StudentRow, unknown>[] = [
      {
        id: 'avatar',
        header: '',
        accessorKey: 'avatar',
        cell: ({ row }) => {
          const avatar = row.original.avatar as string | null | undefined;
          const initials =
            `${String(row.original.firstName ?? '')?.[0] ?? ''}${String(row.original.lastName ?? '')?.[0] ?? ''}`.toUpperCase();
          const avatarUrl = avatar
            ? `/api/uploads/pfps/${avatar}`
            : '/api/uploads/pfps/default-avatar.png';
          return (
            <Avatar className="h-10 w-10">
              <AvatarImage
                src={avatarUrl}
                alt={
                  String(row.original.firstName ?? '') + ' ' + String(row.original.lastName ?? '')
                }
              />
              <AvatarFallback className="bg-secondary text-secondary-foreground">
                {initials || 'U'}
              </AvatarFallback>
            </Avatar>
          );
        },
        meta: { priority: 1 },
      },
      {
        accessorKey: 'firstName',
        header: 'First Name',
        cell: ({ row }) => <div>{String(row.original.firstName ?? '')}</div>,
        meta: { priority: 1 },
      },
      {
        accessorKey: 'lastName',
        header: 'Last Name',
        cell: ({ row }) => <div>{String(row.original.lastName ?? '')}</div>,
        meta: { priority: 1 },
      },
    ];

    for (const a of assignments) {
      cols.push({
        id: a.id,
        accessorKey: a.id,
        header: a.title,
        cell: ({ row }) => {
          const val = row.original[a.id];
          const studentId = row.original.id as string;
          const isEditing =
            editingCell?.studentId === studentId && editingCell?.assignmentId === a.id;
          const gradeKey = `${studentId}-${a.id}`;
          const isSaving = savingGrades.has(gradeKey);

          if (isEditing) {
            return (
              <div className="flex items-center gap-1">
                <Input
                  type="number"
                  min={0}
                  max={a.maxPoints ?? 0}
                  step="1.0"
                  value={editingValue}
                  onChange={(e) => setEditingValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleGradeSave(studentId, a.id, a.maxPoints ?? 0);
                    } else if (e.key === 'Escape') {
                      e.preventDefault();
                      handleGradeCancel();
                    }
                  }}
                  className="h-full w-full text-center"
                  placeholder={`0-${a.maxPoints ?? 0}`}
                  autoFocus
                />
              </div>
            );
          }

          return (
            <div
              className="flex h-full w-full cursor-pointer items-center justify-center rounded px-2 py-1 hover:bg-neutral-300"
              onClick={() => handleGradeEdit(studentId, a.id, val)}
              title="Click to edit grade"
            >
              {isSaving ? (
                <span className="text-muted-foreground">Saving...</span>
              ) : (
                <span className={val === null || val === undefined ? 'text-muted-foreground' : ''}>
                  {val === null || val === undefined ? '-' : String(val)}
                </span>
              )}
            </div>
          );
        },
        meta: { priority: 2 },
      });
    }

    return cols;
  }, [
    assignments,
    editingCell,
    editingValue,
    savingGrades,
    handleGradeEdit,
    handleGradeSave,
    handleGradeCancel,
  ]);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-2xl">
            <Table className="h-5 w-5" />
            Grades
          </CardTitle>
          <div className="flex items-center gap-2">
            {lastUpdated ? (
              <div className="text-muted-foreground text-xs">
                Last updated: {formatTimeInTimeZone(lastUpdated, timezone)}
              </div>
            ) : null}
            <Button
              variant="secondary"
              size="sm"
              onClick={fetchGrades}
              disabled={loading}
              className="flex items-center gap-2 bg-green-600 text-white hover:bg-green-700"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Instructions */}
        <div className="text-muted-foreground flex items-center gap-2 text-sm">
          <div className="flex items-center gap-1">
            <div className="h-2 w-2 rounded-full bg-blue-500"></div>
            Click any grade cell to edit
          </div>
          <div className="flex items-center gap-1">
            <div className="h-2 w-2 rounded-full bg-green-500"></div>
            Press Enter to save, Escape to cancel
          </div>
        </div>

        <DataTable columns={columns} data={students} loading={loading} showExportButton={false} />
      </CardContent>
    </Card>
  );
}
