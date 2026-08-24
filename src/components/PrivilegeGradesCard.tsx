'use client';

import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { DataTable } from '@/components/ui/data-table';
import type { ColumnDef, OnChangeFn, PaginationState, SortingState } from '@tanstack/react-table';
import { Badge } from '@/components/ui/badge';
import { ENROLLMENT_STATUS_BADGE } from '@/lib/badge-presets';
import { Button } from '@/components/ui/button';
import { showToast } from '@/lib/toast';
import { Table, Download, RefreshCw, GraduationCap } from 'lucide-react';
import { useEffectiveTimezone } from '@/hooks/use-effective-timezone';
import dynamic from 'next/dynamic';
import { formatTimeInTimeZone } from '@/lib/date-format';
import { findCanvasReservedTitleConflicts, type LmsPlatform } from '@/lib/lms-grade-export';
import { useSession } from 'next-auth/react';
import { apiPaths } from '@/lib/api-paths';
import { queryKeys } from '@/lib/query-keys';

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

// One row as the server sends it: the student, plus their assigned flags and grades keyed
// by assignment id. `assigned` is what lets a cell tell "not assigned" apart from
// "assigned but ungraded".
type StudentRow = {
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
  enrollmentStatus?: string;
  assigned: Record<string, boolean>;
  grades: Record<string, number | null>;
  [key: string]: unknown;
};

type Assignment = {
  id: string;
  title: string;
  dueDate?: string;
  maxPoints?: number;
};

const EMPTY_STUDENTS: StudentRow[] = [];
const EMPTY_ASSIGNMENTS: Assignment[] = [];

const DEFAULT_PAGE_SIZE = 10;

export function PrivilegeGradesCard({ courseId }: { courseId: string }) {
  const VISIBILITY_REFRESH_MS = 60_000;
  const { data: session } = useSession();
  const { timezone } = useEffectiveTimezone();
  const queryClient = useQueryClient();
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const exportMounted = useMountedOnce(exportDialogOpen);
  const canExport = Boolean(session?.user?.isAdmin);

  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  // searchInput is what the user is typing; search is the committed (debounced) query.
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [sorting, setSorting] = useState<SortingState>([{ id: 'lastName', desc: false }]);

  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(searchInput.trim());
      setPageIndex(0);
    }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  // The assignment columns are the same for every page, so they are fetched once per
  // course. The server already orders them by due date.
  const columnsQuery = useQuery({
    queryKey: queryKeys.course.gradeColumns(courseId),
    queryFn: async () => {
      const res = await fetch(apiPaths.courseGradeColumns(courseId));
      if (!res.ok)
        throw new Error(
          (await res.json())?.error || 'Could not load grades. Refresh the page to try again.',
        );
      return (await res.json()) as { assignments: Assignment[]; totalStudents: number };
    },
    staleTime: 30_000,
  });

  const sort = sorting[0];
  const pageParams = {
    page: pageIndex + 1,
    pageSize,
    q: search || undefined,
    sortBy: sort?.id,
    sortDir: sort?.desc ? 'desc' : 'asc',
  };

  // One page of students, each row carrying its own grades. keepPreviousData holds the
  // current page on screen while the next one loads.
  const pageQuery = useQuery({
    queryKey: queryKeys.course.gradePage(courseId, pageParams),
    queryFn: async () => {
      const res = await fetch(apiPaths.courseGradePage(courseId, pageParams), {
        cache: 'no-store',
      });
      if (!res.ok)
        throw new Error(
          (await res.json())?.error || 'Could not load grades. Refresh the page to try again.',
        );
      const body = (await res.json()) as { rows: StudentRow[]; total: number };
      return { ...body, fetchedAt: Date.now() };
    },
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });

  const students = pageQuery.data?.rows ?? EMPTY_STUDENTS;
  const assignments = columnsQuery.data?.assignments ?? EMPTY_ASSIGNMENTS;
  const total = pageQuery.data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  // Drives the refresh/export button state (disabled + spinner) during any fetch.
  const loading =
    columnsQuery.isPending ||
    columnsQuery.isFetching ||
    pageQuery.isPending ||
    pageQuery.isFetching;
  const lastUpdated = useMemo(
    () => (pageQuery.data ? new Date(pageQuery.data.fetchedAt) : null),
    [pageQuery.data],
  );

  const handlePaginationChange: OnChangeFn<PaginationState> = (updater) => {
    const next = typeof updater === 'function' ? updater({ pageIndex, pageSize }) : updater;
    setPageIndex(next.pageIndex);
    setPageSize(next.pageSize);
  };

  // Sorting is server-side; changing it resets to the first page.
  const handleSortingChange: OnChangeFn<SortingState> = (updater) => {
    const next = typeof updater === 'function' ? updater(sorting) : updater;
    setSorting(next);
    setPageIndex(0);
  };

  const refreshGrades = useCallback(
    () => queryClient.invalidateQueries({ queryKey: queryKeys.course.grades(courseId) }),
    [queryClient, courseId],
  );

  // Surface fetch failures as a toast, preserving the prior behavior.
  const gradesError = columnsQuery.isError || pageQuery.isError;
  useEffect(() => {
    if (gradesError) {
      console.error('Fetch grades error:', columnsQuery.error ?? pageQuery.error);
      showToast.error('Could not load grades. Refresh the page to try again.');
    }
  }, [gradesError, columnsQuery.error, pageQuery.error]);

  // Refresh data when the tab becomes visible again and the cached page is stale.
  const valuesFetchedAt = pageQuery.data?.fetchedAt;
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
      let earned = 0;
      let available = 0;
      let gradeCount = 0;
      for (const a of assignments) {
        // Points available counts only assignments assigned to this student, so a
        // student who isn't assigned everything isn't measured against the full total.
        // `averagePct` in lib/course-grades is the server-side twin of this, used to
        // order the whole roster when the Average column is sorted; keep them in step.
        if (row.assigned?.[a.id] === false) continue;
        available += a.maxPoints ?? 0;
        const val = row.grades?.[a.id];
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
        accessorKey: 'lastName',
        header: 'Last Name',
        cell: ({ row }) => (
          <div className="flex items-center gap-2">
            <span>{String(row.original.lastName ?? '')}</span>
            {row.original.enrollmentStatus === 'DROPPED' ? (
              <Badge variant={ENROLLMENT_STATUS_BADGE.DROPPED}>Dropped</Badge>
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
        // Sorting is the server's: it orders every student by this assignment's grade,
        // not just the page on screen. The accessor still reads the row so the toolbar's
        // search and the mobile cards have a value to show.
        accessorFn: (row) => row.grades?.[a.id] ?? undefined,
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
          const isAssigned = user.assigned?.[a.id] !== false;

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

          const val = user.grades?.[a.id];

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
      // Sorted server-side across the whole roster; see `averagePct` in lib/course-grades.
      accessorFn: (row) => computeAverage(row)?.pct,
      cell: ({ row }) => {
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
    // Only the columns matter now: every value a cell renders comes off its own row, so a
    // new page of grades no longer rebuilds the column definitions.
  }, [assignments]);

  return (
    <div className="space-y-6">
      <div>
        <div className="flex flex-wrap items-center justify-between gap-y-1">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <h2 className="flex items-center gap-2 text-xl font-semibold">
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
          loading={pageQuery.isLoading}
          tableLabel="Course grades table"
          bordered
          // Its own entry: without a key it shared the default one with every other
          // unnamed table, so hiding a column here hid it on unrelated pages.
          storageKey="course-grades-columns-v1"
          // The LMS export replaces it, and it covers every student rather than the page.
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
          manualPagination
          pageCount={pageCount}
          rowCount={total}
          pagination={{ pageIndex, pageSize }}
          onPaginationChange={handlePaginationChange}
          manualFiltering
          globalFilter={searchInput}
          onGlobalFilterChange={setSearchInput}
          manualSorting
          sorting={sorting}
          onSortingChange={handleSortingChange}
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
