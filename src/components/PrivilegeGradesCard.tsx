'use client';

import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getInitials } from '@/app/utils/initials';
import { DataTable } from '@/components/ui/data-table';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import type { ColumnDef } from '@tanstack/react-table';
import { Button } from '@/components/ui/button';
import { showToast } from '@/lib/toast';
import { Table, Download, RefreshCw, GraduationCap } from 'lucide-react';
import { useEffectiveTimezone } from '@/hooks/use-effective-timezone';
import { GradeBreakdownDialog } from '@/components/dialogs/GradeBreakdownDialog';
import { formatTimeInTimeZone } from '@/lib/date';
import { GradesLmsExportDialog } from '@/components/dialogs/GradesLmsExportDialog';
import { findCanvasReservedTitleConflicts, type LmsPlatform } from '@/lib/lms-grade-export';
import { useSession } from 'next-auth/react';
import { apiPaths } from '@/lib/api-paths';

type StudentRow = {
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
  cropX?: number;
  cropY?: number;
  zoom?: number;
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
  email: string;
  firstName?: string;
  lastName?: string;
  avatar?: string;
  cropX?: number;
  cropY?: number;
  zoom?: number;
};

type GradesResponse = {
  students: ApiStudent[];
  assignments: Assignment[];
  grades: Record<string, Record<string, number | null>>;
  // assigned[studentId][assignmentId]; a false cell renders as a gray "not assigned" box.
  assigned?: Record<string, Record<string, boolean>>;
};

// Per-row key holding the student's assignment-assigned flags, so the cell renderer can
// tell "not assigned" (gray box) apart from "assigned but ungraded" (blank).
const ASSIGNED_KEY = '__assigned';

type GradesData = {
  students: StudentRow[];
  assignments: Assignment[];
  fetchedAt: number;
};

const EMPTY_STUDENTS: StudentRow[] = [];
const EMPTY_ASSIGNMENTS: Assignment[] = [];

export function PrivilegeGradesCard({ courseId }: { courseId: string }) {
  const VISIBILITY_REFRESH_MS = 60_000;
  const { data: session } = useSession();
  const { timezone } = useEffectiveTimezone();
  const queryClient = useQueryClient();
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const canExport = Boolean(session?.user?.isAdmin);

  // Cached students × assignments grade matrix. Fetched cold on mount (no SSR
  // seed) and re-pulled via invalidation after a grade edit or the visibility
  // refresh.
  const gradesQuery = useQuery<GradesData>({
    queryKey: ['course', courseId, 'grades'],
    queryFn: async () => {
      const res = await fetch(apiPaths.courseGrades(courseId));
      if (!res.ok) throw new Error((await res.json())?.error || 'Failed to load grades');
      const body = (await res.json()) as GradesResponse;

      const { students: s, assignments: a, grades, assigned } = body;

      // maxPoints is already computed by the grades API (sum of problem max points)
      const assignmentsWithPoints: Assignment[] = a.map((asg) => ({
        ...asg,
        maxPoints: (asg as Assignment & { maxPoints?: number }).maxPoints ?? 0,
      }));

      // Build rows
      const rows: StudentRow[] = s.map((stu) => {
        const row: StudentRow = {
          id: stu.id,
          email: stu.email,
          avatar: stu.avatar,
          firstName: stu.firstName,
          lastName: stu.lastName,
          cropX: stu.cropX,
          cropY: stu.cropY,
          zoom: stu.zoom,
        };
        const assignedFlags: Record<string, boolean> = {};
        for (const asg of a) {
          const grade = grades?.[stu.id]?.[asg.id];
          row[asg.id] = grade ?? null;
          // Default to assigned when the flag is absent (older payloads / safety).
          assignedFlags[asg.id] = assigned?.[stu.id]?.[asg.id] !== false;
        }
        row[ASSIGNED_KEY] = assignedFlags;
        return row;
      });

      return {
        students: rows,
        assignments: assignmentsWithPoints,
        fetchedAt: Date.now(),
      };
    },
    staleTime: 30_000,
  });

  const students = gradesQuery.data?.students ?? EMPTY_STUDENTS;
  const assignments = gradesQuery.data?.assignments ?? EMPTY_ASSIGNMENTS;
  // Drives the refresh/export button state (disabled + spinner) during any fetch.
  // The grades table itself blocks only on a cold load (isPending); see below;
  // so a background refresh doesn't hide the cached grid.
  const loading = gradesQuery.isPending || gradesQuery.isFetching;
  const lastUpdated = useMemo(
    () => (gradesQuery.data ? new Date(gradesQuery.data.fetchedAt) : null),
    [gradesQuery.data],
  );

  const refreshGrades = useCallback(
    () => queryClient.invalidateQueries({ queryKey: ['course', courseId, 'grades'] }),
    [queryClient, courseId],
  );

  // Surface fetch failures as a toast, preserving the prior behavior.
  useEffect(() => {
    if (gradesQuery.isError) {
      console.error('Fetch grades error:', gradesQuery.error);
      showToast.error('Failed to load grades');
    }
  }, [gradesQuery.isError, gradesQuery.error]);

  // Refresh data when the tab becomes visible again and the cached matrix is stale.
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        const fetchedAt = gradesQuery.data?.fetchedAt ?? 0;
        if (Date.now() - fetchedAt < VISIBILITY_REFRESH_MS) {
          return;
        }
        // Page became visible and data is stale, refresh data.
        void refreshGrades();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [gradesQuery.data?.fetchedAt, refreshGrades]);

  const exportGrades = useCallback(
    (platform: LmsPlatform, assignmentIds: string[]) => {
      const selectedForExport = assignments.filter((assignment) =>
        assignmentIds.includes(assignment.id),
      );
      if (selectedForExport.length === 0) {
        showToast.error('Please select an assignment to export.');
        return;
      }

      // Canvas ignores columns whose title contains a reserved word; warn (don't block)
      // so staff know those grades won't import.
      if (platform === 'canvas') {
        const conflicts = findCanvasReservedTitleConflicts(
          selectedForExport.map((assignment) => assignment.title),
        );
        if (conflicts.length > 0) {
          showToast.warning(
            `Canvas will ignore these columns because their titles contain reserved words: ${conflicts.join(
              ', ',
            )}. Rename the assignment or edit the CSV before importing.`,
          );
        }
      }

      // The CSV is generated (and the export audited) server-side; just trigger the
      // download. The server names the file via Content-Disposition.
      const params = new URLSearchParams({ platform, assignments: assignmentIds.join(',') });
      const link = document.createElement('a');
      link.href = `${apiPaths.courseGradesExport(courseId)}?${params.toString()}`;
      document.body.appendChild(link);
      link.click();
      link.remove();

      showToast.success(`Grades exported for ${platform}`);
    },
    [assignments, courseId],
  );

  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedStudent, setSelectedStudent] = useState<{ id: string; name: string } | null>(null);
  const [selectedAssignment, setSelectedAssignment] = useState<Assignment | null>(null);

  const columns = useMemo<ColumnDef<StudentRow, unknown>[]>(() => {
    const cols: ColumnDef<StudentRow, unknown>[] = [
      {
        id: 'avatar',
        header: '',
        accessorKey: 'avatar',
        enableSorting: false,
        cell: ({ row }) => {
          const user = row.original;
          return (
            <Avatar className="h-10 w-10">
              <AvatarImage
                src={user.avatar ? apiPaths.files.pfp(String(user.avatar)) : undefined}
                alt={`${user.firstName} ${user.lastName}`}
                cropX={user.cropX ?? 0.5}
                cropY={user.cropY ?? 0.5}
                zoom={user.zoom ?? 1}
              />
              <AvatarFallback className="bg-secondary text-secondary-foreground">
                {getInitials(user.firstName, user.lastName, user.email)}
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
          const user = row.original;
          const val = user[a.id];
          const max = a.maxPoints;
          const assignedFlags = user[ASSIGNED_KEY] as Record<string, boolean> | undefined;
          const isAssigned = assignedFlags?.[a.id] !== false;

          // Not assigned to this student: show a solid gray box instead of a grade.
          // role="img" so the accessible name is announced (a bare div's aria-label is
          // not reliably surfaced); the sr-only text is a belt-and-braces fallback.
          if (!isAssigned) {
            return (
              <div
                role="img"
                aria-label="Not assigned"
                title="Not assigned"
                className="bg-muted mx-auto h-6 w-full rounded"
              >
                <span className="sr-only">Not assigned</span>
              </div>
            );
          }

          const handleClick = () => {
            setSelectedStudent({ id: user.id, name: `${user.firstName} ${user.lastName}` });
            setSelectedAssignment(a);
            setDialogOpen(true);
          };

          return (
            <button
              type="button"
              className="flex h-full w-full cursor-pointer items-center justify-center rounded px-2 py-1 hover:bg-neutral-300"
              title="View grade breakdown"
              onClick={handleClick}
              aria-label={`View breakdown for ${user.firstName} ${user.lastName} on ${a.title}`}
            >
              <span className="text-sm">
                {val === null || val === undefined ? '-' : String(val)}
              </span>
              <span className="text-muted-foreground text-sm">
                {max === null || max === undefined ? '/-' : `/${String(max)}`}
              </span>
            </button>
          );
        },
        meta: { priority: 2, align: 'center' },
      });
    }

    cols.push({
      id: 'totalGrade',
      header: 'Total',
      cell: ({ row }) => {
        let earned = 0;
        let possible = 0;
        let gradeCount = 0;
        for (const a of assignments) {
          const val = row.original[a.id];
          if (val !== null && val !== undefined) {
            earned += Number(val);
            possible += a.maxPoints ?? 0;
            gradeCount++;
          }
        }
        if (gradeCount === 0) return <span className="text-muted-foreground">-</span>;
        if (possible === 0) return <span className="text-muted-foreground">-</span>;
        const pct = ((earned / possible) * 100).toFixed(1);
        return <span className="font-medium">{pct}%</span>;
      },
      meta: { priority: 1, align: 'center' },
    });

    return cols;
  }, [assignments]);

  return (
    <div className="space-y-6">
      <div>
        <div className="flex flex-wrap items-center justify-between gap-y-1">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <h2 className="flex items-center gap-2 text-2xl font-semibold">
              <Table className="h-5 w-5" />
              Grades
            </h2>
            <div className="text-muted-foreground flex items-center gap-1 text-sm">
              <div aria-hidden="true" className="h-2 w-2 rounded-full bg-blue-500"></div>
              Click a grade to view/edit details
            </div>
          </div>
          {lastUpdated ? (
            <div className="text-muted-foreground text-xs">
              Last updated: {formatTimeInTimeZone(lastUpdated, timezone)}
            </div>
          ) : null}
        </div>
      </div>
      <div className="space-y-6">
        <DataTable
          columns={columns}
          data={students}
          loading={gradesQuery.isPending}
          tableLabel="Course grades table"
          showExportButton={false}
          emptyTitle="No grades to show"
          emptyDescription="Grades appear once students are enrolled and have submitted work."
          emptyIcon={GraduationCap}
          loadingMessage="Loading grades, please wait..."
          actionButtons={
            <>
              <Button
                variant="secondary"
                onClick={() => void refreshGrades()}
                disabled={loading}
                className="flex items-center gap-2 bg-green-600 text-white hover:bg-green-700"
              >
                <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                Refresh
              </Button>
              {canExport ? (
                <Button
                  variant="default"
                  onClick={() => setExportDialogOpen(true)}
                  disabled={loading || students.length === 0}
                  className="flex items-center gap-2"
                >
                  <Download className="h-4 w-4" />
                  Export Grades
                </Button>
              ) : null}
            </>
          }
        />
      </div>

      {/* breakdown dialog */}
      {selectedStudent && selectedAssignment && (
        <GradeBreakdownDialog
          courseId={courseId}
          assignmentId={selectedAssignment.id}
          assignmentTitle={selectedAssignment.title}
          studentId={selectedStudent.id}
          studentName={selectedStudent.name}
          open={dialogOpen}
          setOpen={setDialogOpen}
          onSaved={() => void refreshGrades()}
        />
      )}

      {canExport ? (
        <GradesLmsExportDialog
          open={exportDialogOpen}
          setOpen={setExportDialogOpen}
          onExport={exportGrades}
          assignments={assignments.map((assignment) => ({
            id: assignment.id,
            title: assignment.title,
          }))}
          disabled={loading || students.length === 0}
        />
      ) : null}
    </div>
  );
}
