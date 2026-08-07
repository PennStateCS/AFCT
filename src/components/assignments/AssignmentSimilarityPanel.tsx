'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import type { ColumnDef } from '@tanstack/react-table';
import { Fingerprint, AlertTriangle } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { DataTable } from '@/components/ui/data-table';
import LoadingSpinner from '@/components/ui/loading-spinner';
import { apiPaths } from '@/lib/api-paths';
import { queryKeys } from '@/lib/query-keys';
import { apiClient } from '@/lib/api/fetch-client';
import { formatDateInTimeZone, zoneAbbrev, parseValidDate } from '@/lib/date-format';
import { useEffectiveTimezone } from '@/hooks/use-effective-timezone';

type SuspiciousSubmissionRow = {
  id: string;
  submittedAt: string;
  fileName: string | null;
  originalFileName: string | null;
  isSuspicious: boolean | null;
  isSuspiciousOverride: boolean | null;
  isSuspiciousReason: string | null;
  student: {
    id: string;
    firstName: string | null;
    lastName: string | null;
    avatar: string | null;
    cropX: number | null;
    cropY: number | null;
    zoom: number | null;
  };
  problem: {
    id: string;
    title: string | null;
  };
  studentGroup: { id: string; name: string } | null;
};

function getInitials(firstName: string | null, lastName: string | null): string {
  const names = [firstName ?? '', lastName ?? ''].filter(Boolean) as string[];
  if (names.length === 0) return '??';
  return names.map((name) => name.charAt(0).toUpperCase()).join('').slice(0, 2);
}

function formatSubmittedAt(dateValue: string, timeZone: string) {
  const date = parseValidDate(dateValue);
  if (!date) return 'Unknown';
  return `${formatDateInTimeZone(date, timeZone)} ${zoneAbbrev(date, timeZone)}`;
}

export function AssignmentSimilarityPanel() {
  const { id: courseId, aid: assignmentId } = useParams<{ id: string; aid: string }>();
  const { timezone } = useEffectiveTimezone();

  const query = useQuery({
    queryKey: queryKeys.assignment.similarity(courseId, assignmentId),
    queryFn: async () =>
      apiClient.get<SuspiciousSubmissionRow[]>(
        apiPaths.assignmentSimilarity(courseId, assignmentId),
      ),
    enabled: !!courseId && !!assignmentId,
    staleTime: 30_000,
  });

  const columns = useMemo<ColumnDef<SuspiciousSubmissionRow, unknown>[]>(
    () => [
      {
        id: 'student',
        header: 'Student',
        accessorFn: (row) => `${row.student.lastName ?? ''}, ${row.student.firstName ?? ''}`,
        cell: ({ row }) => {
          const student = row.original.student;
          const name = `${student.firstName ?? ''} ${student.lastName ?? ''}`.trim() || 'Unknown student';
          return (
            <div className="flex items-center gap-3">
              <Avatar className="h-10 w-10">
                <AvatarImage
                  src={student.avatar ? apiPaths.files.pfp(student.avatar) : undefined}
                  alt={name}
                  cropX={student.cropX ?? 0.5}
                  cropY={student.cropY ?? 0.5}
                  zoom={student.zoom ?? 1}
                />
                <AvatarFallback>{getInitials(student.firstName, student.lastName)}</AvatarFallback>
              </Avatar>
              <div className="min-w-0">
                <div className="font-medium">{name}</div>
                {row.original.studentGroup ? (
                  <div className="text-muted-foreground text-xs">
                    Group: {row.original.studentGroup.name}
                  </div>
                ) : null}
              </div>
            </div>
          );
        },
        meta: { priority: 1, rowHeader: true },
      },
      {
        accessorKey: 'problem.title',
        header: 'Problem',
        cell: ({ row }) => row.original.problem.title ?? 'Unknown',
        meta: { priority: 2 },
      },
      {
        accessorKey: 'submittedAt',
        header: 'Submitted',
        cell: ({ row }) => formatSubmittedAt(row.original.submittedAt, timezone),
        meta: { priority: 2, align: 'center' },
      },
      {
        header: 'File',
        accessorFn: (row) => row.originalFileName ?? row.fileName ?? 'Unknown',
        cell: ({ row }) => row.original.originalFileName ?? row.original.fileName ?? '—',
        meta: { priority: 3 },
      },
      {
        id: 'status',
        header: 'Flag',
        accessorFn: (row) =>
          row.isSuspiciousOverride ? 'Override' : row.isSuspicious ? 'Suspicious' : 'Review',
        cell: ({ row }) => {
          const value = row.original.isSuspiciousOverride
            ? 'Override'
            : row.original.isSuspicious
            ? 'Suspicious'
            : 'Review';
          return (
            <span
              className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold ${
                row.original.isSuspiciousOverride
                  ? 'bg-warning/15 text-warning'
                  : row.original.isSuspicious
                  ? 'bg-destructive/15 text-destructive'
                  : 'bg-muted/15 text-muted-foreground'
              }`}
            >
              {value}
            </span>
          );
        },
        meta: { priority: 3, align: 'center' },
      },
      {
        id: 'reason',
        header: 'Reason',
        cell: ({ row }) => (
          <details className="rounded-lg border border-border bg-muted p-2">
            <summary className="flex items-center justify-between gap-2 text-sm font-medium text-foreground hover:text-primary">
              <span>View reason</span>
              <AlertTriangle className="h-4 w-4" aria-hidden="true" />
            </summary>
            <div className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">
              {row.original.isSuspiciousReason ?? 'No reason provided.'}
            </div>
          </details>
        ),
        meta: { priority: 4 },
      },
    ],
    [timezone],
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-2xl font-semibold">
        <Fingerprint className="h-6 w-6" />
        <h2>Similarity</h2>
      </div>

      {query.isPending ? (
        <LoadingSpinner label="Loading suspicious submissions" />
      ) : query.isError ? (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800"
        >
          Could not load suspicious submissions. Try refreshing the page.
        </div>
      ) : (
        <DataTable
          columns={columns}
          data={query.data ?? []}
          loading={query.isFetching}
          tableLabel="Suspicious submissions"
          showToolbar={false}
          emptyTitle="No suspicious submissions found"
          emptyDescription="No submissions have been flagged as suspicious for this assignment."
        />
      )}
    </div>
  );
}
