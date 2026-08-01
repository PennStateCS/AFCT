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
import dynamic from 'next/dynamic';
import { formatTimeInTimeZone } from '@/lib/date-format';
import { findCanvasReservedTitleConflicts, type LmsPlatform } from '@/lib/lms-grade-export';
import { useSession } from 'next-auth/react';
import { apiPaths } from '@/lib/api-paths';

/**
 * On demand: the breakdown dialog carries the form stack and was the last thing putting zod on
 * the course page. Each is also rendered only once opened, since a dynamic import is deferred
 * only while its component is unrendered.
 */
const GradeBreakdownDialog = dynamic(
  () => import('@/components/dialogs/GradeBreakdownDialog').then((m) => m.GradeBreakdownDialog),
  { ssr: false },
);
const GradesLmsExportDialog = dynamic(
  () => import('@/components/dialogs/GradesLmsExportDialog').then((m) => m.GradesLmsExportDialog),
  { ssr: false },
);

/** True once `open` has first been true, so a dynamic import stays deferred until first use. */
function useMountedOnce(open: boolean): boolean {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    if (open) setMounted(true);
  }, [open]);
  return mounted || open;
}

type StudentRow = {
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
  cropX?: number;
  cropY?: number;
  zoom?: number;
  enrollmentStatus?: string;
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
  enrollmentStatus?: string;
};

// Per-row key holding the student's assignment-assigned flags, so the cell renderer can
// tell "not assigned" apart from "assigned but ungraded".
const ASSIGNED_KEY = '__assigned';

const EMPTY_STUDENTS: StudentRow[] = [];
const EMPTY_ASSIGNMENTS: Assignment[] = [];

// Placeholder shown in a grade/average cell while the grade values are still loading,
// after the table's columns and rows have already painted from the structure request.
const GradeCellSkeleton = () => (
  <span aria-hidden="true" className="bg-muted mx-auto block h-4 w-10 animate-pulse rounded" />
);

export function PrivilegeGradesCard({ courseId }: { courseId: string }) {
  const VISIBILITY_REFRESH_MS = 60_000;
  const { data: session } = useSession();
  const { timezone } = useEffectiveTimezone();
  const queryClient = useQueryClient();
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const exportMounted = useMountedOnce(exportDialogOpen);
  const canExport = Boolean(session?.user?.isAdmin);

  // The gradebook loads in two halves so the table paints its columns and rows while the
  // grade cells are still loading. `structure` (students + assignments + assigned) is the
  // fast part and drives the table; `values` (the grades map) is the slower aggregation
  // and fills the cells when it arrives. Both are invalidated together on refresh.
  const structureQuery = useQuery({
    queryKey: ['course', courseId, 'grades', 'structure'],
    queryFn: async () => {
      const res = await fetch(apiPaths.courseGrades(courseId, 'structure'));
      if (!res.ok)
        throw new Error(
          (await res.json())?.error || 'Could not load grades. Refresh the page to try again.',
        );
      const body = (await res.json()) as {
        students: ApiStudent[];
        assignments: Assignment[];
        assigned?: Record<string, Record<string, boolean>>;
      };

      // Order the columns left-to-right by due date (earliest first); assignments with
      // no due date sort to the end. maxPoints comes from the API.
      const dueTime = (asg: Assignment) => {
        const t = asg.dueDate ? Date.parse(asg.dueDate) : NaN;
        return Number.isNaN(t) ? Number.POSITIVE_INFINITY : t;
      };
      const assignmentsWithPoints: Assignment[] = body.assignments
        .map((asg) => ({
          ...asg,
          maxPoints: (asg as Assignment & { maxPoints?: number }).maxPoints ?? 0,
        }))
        .sort((x, y) => dueTime(x) - dueTime(y));

      const rows: StudentRow[] = body.students.map((stu) => {
        const row: StudentRow = {
          id: stu.id,
          email: stu.email,
          avatar: stu.avatar,
          firstName: stu.firstName,
          lastName: stu.lastName,
          cropX: stu.cropX,
          cropY: stu.cropY,
          zoom: stu.zoom,
          enrollmentStatus: stu.enrollmentStatus,
        };
        const assignedFlags: Record<string, boolean> = {};
        for (const asg of body.assignments) {
          // Default to assigned when the flag is absent (older payloads / safety).
          assignedFlags[asg.id] = body.assigned?.[stu.id]?.[asg.id] !== false;
        }
        row[ASSIGNED_KEY] = assignedFlags;
        return row;
      });

      return { students: rows, assignments: assignmentsWithPoints };
    },
    staleTime: 30_000,
  });

  const valuesQuery = useQuery({
    queryKey: ['course', courseId, 'grades', 'values'],
    queryFn: async () => {
      const res = await fetch(apiPaths.courseGrades(courseId, 'values'));
      if (!res.ok)
        throw new Error(
          (await res.json())?.error || 'Could not load grades. Refresh the page to try again.',
        );
      const body = (await res.json()) as {
        grades: Record<string, Record<string, number | null>>;
      };
      return { grades: body.grades, fetchedAt: Date.now() };
    },
    staleTime: 30_000,
  });

  const students = structureQuery.data?.students ?? EMPTY_STUDENTS;
  const assignments = structureQuery.data?.assignments ?? EMPTY_ASSIGNMENTS;
  const gradesMap = valuesQuery.data?.grades;
  // Cells show a skeleton only on the first values load; a background refresh keeps the
  // previous grades visible instead of flashing skeletons.
  const valuesLoading = valuesQuery.isPending;
  // Drives the refresh/export button state (disabled + spinner) during any fetch.
  const loading =
    structureQuery.isPending ||
    structureQuery.isFetching ||
    valuesQuery.isPending ||
    valuesQuery.isFetching;
  const lastUpdated = useMemo(
    () => (valuesQuery.data ? new Date(valuesQuery.data.fetchedAt) : null),
    [valuesQuery.data],
  );

  const refreshGrades = useCallback(
    () => queryClient.invalidateQueries({ queryKey: ['course', courseId, 'grades'] }),
    [queryClient, courseId],
  );

  // Surface fetch failures as a toast, preserving the prior behavior.
  const gradesError = structureQuery.isError || valuesQuery.isError;
  useEffect(() => {
    if (gradesError) {
      console.error('Fetch grades error:', structureQuery.error ?? valuesQuery.error);
      showToast.error('Could not load grades. Refresh the page to try again.');
    }
  }, [gradesError, structureQuery.error, valuesQuery.error]);

  // Refresh data when the tab becomes visible again and the cached matrix is stale.
  const valuesFetchedAt = valuesQuery.data?.fetchedAt;
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        if (Date.now() - (valuesFetchedAt ?? 0) < VISIBILITY_REFRESH_MS) {
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
  }, [valuesFetchedAt, refreshGrades]);

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
  const breakdownMounted = useMountedOnce(dialogOpen);
  const [selectedStudent, setSelectedStudent] = useState<{ id: string; name: string } | null>(null);
  const [selectedAssignment, setSelectedAssignment] = useState<Assignment | null>(null);

  const columns = useMemo<ColumnDef<StudentRow, unknown>[]>(() => {
    // The student's average across graded assignments: the percentage plus the raw
    // points earned. Undefined when they have no graded work. Shared by the Average
    // cell and its sort accessor.
    const computeAverage = (
      row: StudentRow,
    ): { pct: number; earned: number; available: number } | undefined => {
      const assignedFlags = row[ASSIGNED_KEY] as Record<string, boolean> | undefined;
      let earned = 0;
      let available = 0;
      let gradeCount = 0;
      for (const a of assignments) {
        // Points available counts only assignments assigned to this student, so a
        // student who isn't assigned everything isn't measured against the full total.
        if (assignedFlags?.[a.id] === false) continue;
        available += a.maxPoints ?? 0;
        const val = gradesMap?.[row.id]?.[a.id];
        if (val !== null && val !== undefined) {
          earned += Number(val);
          gradeCount++;
        }
      }
      if (gradeCount === 0 || available === 0) return undefined;
      return { pct: (earned / available) * 100, earned, available };
    };

    const cols: ColumnDef<StudentRow, unknown>[] = [
      {
        id: 'avatar',
        header: '',
        accessorKey: 'avatar',
        enableSorting: false,
        cell: ({ row }) => {
          const user = row.original;
          return (
            <div className="flex items-center justify-center">
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
            </div>
          );
        },
        meta: { priority: 1, align: 'center' },
      },
      {
        accessorKey: 'lastName',
        header: 'Last Name',
        cell: ({ row }) => (
          <div className="flex items-center gap-2">
            <span>{String(row.original.lastName ?? '')}</span>
            {row.original.enrollmentStatus === 'DROPPED' ? (
              <span className="bg-status-warning-bg text-status-warning inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium">
                Dropped
              </span>
            ) : null}
          </div>
        ),
        // Row header for the matrix: screen readers announce this name with each grade
        // cell in the row, so a grade is never read as a bare number.
        meta: { priority: 1, rowHeader: true },
      },
      {
        accessorKey: 'firstName',
        header: 'First Name',
        cell: ({ row }) => <div>{String(row.original.firstName ?? '')}</div>,
        meta: { priority: 1 },
      },
    ];

    for (const a of assignments) {
      cols.push({
        id: a.id,
        // Sort by this assignment's grade (from the values map); ungraded sorts last.
        accessorFn: (row) => gradesMap?.[row.id]?.[a.id] ?? undefined,
        sortUndefined: 'last',
        // Two-line header: the assignment title, with the points it's worth beneath it
        // (the cells now show only the earned grade). filterLabel keeps the sort
        // button's accessible name as the title even though the header is JSX.
        header: () => (
          <div className="flex flex-col items-center leading-tight">
            <span>{a.title}</span>
            <span className="text-muted-foreground text-xs font-normal">
              {a.maxPoints ?? 0} pts
            </span>
          </div>
        ),
        cell: ({ row }) => {
          const user = row.original;
          const assignedFlags = user[ASSIGNED_KEY] as Record<string, boolean> | undefined;
          const isAssigned = assignedFlags?.[a.id] !== false;

          // Not assigned to this student: show a muted "N/A" so it's clearly distinct
          // from an assigned-but-ungraded cell (which shows a plain "-"). role="img"
          // with aria-label announces it as "Not assigned"; the title repeats it on
          // hover.
          if (!isAssigned) {
            return (
              <span
                role="img"
                aria-label="Not assigned"
                title="Not assigned"
                className="text-muted-foreground text-xs"
              >
                N/A
              </span>
            );
          }

          // Grades still loading: skeleton (the column/row already painted).
          if (valuesLoading) return <GradeCellSkeleton />;
          const val = gradesMap?.[user.id]?.[a.id];

          const handleClick = () => {
            setSelectedStudent({ id: user.id, name: `${user.firstName} ${user.lastName}` });
            setSelectedAssignment(a);
            setDialogOpen(true);
          };

          return (
            <button
              type="button"
              className="hover:bg-accent flex h-full w-full cursor-pointer items-center justify-center rounded px-2 py-1"
              title="View grade breakdown"
              onClick={handleClick}
              aria-label={`View breakdown for ${user.firstName} ${user.lastName} on ${a.title}`}
            >
              <span className="text-sm">
                {val === null || val === undefined ? '-' : Number(val).toFixed(2)}
              </span>
            </button>
          );
        },
        meta: { priority: 2, align: 'center', filterLabel: a.title },
      });
    }

    cols.push({
      id: 'totalGrade',
      header: 'Average',
      // Sortable via the derived average; students with no graded work sort to the end.
      accessorFn: (row) => computeAverage(row)?.pct,
      sortUndefined: 'last',
      cell: ({ row }) => {
        if (valuesLoading) return <GradeCellSkeleton />;
        const avg = computeAverage(row.original);
        if (avg === undefined) return <span className="text-muted-foreground">-</span>;
        // Percentage over the points earned / points available (assigned assignments).
        return (
          <div className="flex flex-col items-center leading-tight">
            <span className="font-medium">{avg.pct.toFixed(2)}%</span>
            <span className="text-muted-foreground text-xs">
              {Number(avg.earned.toFixed(2))}/{Number(avg.available.toFixed(2))}
            </span>
          </div>
        );
      },
      meta: { priority: 1, align: 'center' },
    });

    return cols;
  }, [assignments, gradesMap, valuesLoading]);

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
              <div aria-hidden="true" className="bg-primary h-2 w-2 rounded-full"></div>
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
          loading={structureQuery.isPending}
          tableLabel="Course grades table"
          bordered
          defaultSorting={[{ id: 'lastName', desc: false }]}
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
                className="flex items-center gap-2"
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
      {selectedStudent && selectedAssignment && breakdownMounted && (
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

      {canExport && exportMounted ? (
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
