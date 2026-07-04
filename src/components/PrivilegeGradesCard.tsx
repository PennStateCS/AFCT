'use client';

import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { getInitials } from '@/app/utils/initials';
import { DataTable } from '@/components/ui/data-table';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { ColumnDef } from '@tanstack/react-table';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { showToast } from '@/lib/toast';
import { Table, Download, RefreshCw } from 'lucide-react';
import { useEffectiveTimezone } from '@/hooks/use-effective-timezone';
import { GradeBreakdownDialog } from '@/components/dialogs/GradeBreakdownDialog';
import { formatTimeInTimeZone } from '@/lib/date';
import { GradesLmsExportDialog } from '@/components/dialogs/GradesLmsExportDialog';
import { buildLmsGradesCsv, type LmsPlatform } from '@/lib/lms-grade-export';
import { useSession } from 'next-auth/react';

type StudentRow = {
  id: string;
  email: string;
  firstName?: string,
  lastName?: string,
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
};

export function PrivilegeGradesCard({ courseId }: { courseId: string }) {
  const VISIBILITY_REFRESH_MS = 60_000;
  const { data: session } = useSession();
  const { timezone } = useEffectiveTimezone();
  const [loading, setLoading] = useState(true);
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const inFlightRef = useRef(false);
  const lastFetchAtRef = useRef(0);
  const canExport = !!session?.user && ['ADMIN', 'FACULTY', 'TA'].includes(session.user.role);

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

  const exportGrades = useCallback(
    (platform: LmsPlatform, assignmentIds: string[]) => {
      const selectedForExport = assignments.filter((assignment) => assignmentIds.includes(assignment.id));
      if (!selectedForExport) {
        showToast.error('Please select an assignment to export.');
        return;
      }

     //const exportAssignments = [{ id: selectedForExport.id, title: selectedForExport.title }];
	  const exportAssignments = selectedForExport.map((assignment) => ({ id: assignment.id, title: assignment.title}));
      const { csvContent, filenamePrefix } = buildLmsGradesCsv(
        platform,
        students,
        exportAssignments,
      );
      const assignmentSlug = selectedForExport[0].title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '');

      // Download CSV
      const timestamp = new Date().toISOString().replace('T', '_').replace(/:/g, '-').split('.')[0];
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      const url = URL.createObjectURL(blob);
      link.setAttribute('href', url);
      link.setAttribute(
        'download',
        `${filenamePrefix}-${assignmentSlug || assignmentIds[0]}-${timestamp}.csv`,
      );
      link.click();

      showToast.success(`Grades exported for ${platform}`);

      // Record the export in the audit log (best-effort; never block the download).
      void fetch(`/api/courses/${courseId}/grades`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          platform,
          wholeGradebook: selectedForExport.length === assignments.length,
          assignmentCount: exportAssignments.length,
          studentCount: students.length,
        }),
      }).catch(() => {});
    },
    [students, assignments, courseId],
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
        cell: ({ row }) => {
          const user = row.original;
          return (
            <Avatar className="h-10 w-10">
              <AvatarImage
                src={`/api/uploads/pfps/${user.avatar}`}
                alt={`${user.firstName} ${user.lastName}`}
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
              aria-label={`View breakdown for ${user.firstName} ${user.l} on ${a.title}`}
            >
              <span className="text-sm">
                {val === null || val === undefined ? '-' : String(val)}
              </span>
              <span className="text-sm text-muted-foreground">
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
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-y-1">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <CardTitle className="flex items-center gap-2 text-2xl">
              <Table className="h-5 w-5" />
              Grades
            </CardTitle>
            <div className="text-muted-foreground flex items-center gap-1 text-sm">
              <div className="h-2 w-2 rounded-full bg-blue-500"></div>
              Click a grade to view/edit details
            </div>
          </div>
          {lastUpdated ? (
            <div className="text-muted-foreground text-xs">
              Last updated: {formatTimeInTimeZone(lastUpdated, timezone)}
            </div>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        <DataTable
          columns={columns}
          data={students}
          loading={loading}
          tableLabel="Course grades table"
          showExportButton={false}
          actionButtons={
            <>
              <Button
                variant="secondary"
                onClick={fetchGrades}
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
      </CardContent>

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
          onSaved={fetchGrades}
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
    </Card>
  );
}
