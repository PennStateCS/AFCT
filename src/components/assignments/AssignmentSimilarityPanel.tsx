'use client';

import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import type { ColumnDef } from '@tanstack/react-table';
import { AlertTriangle, CheckCircle, ChevronDown, Download, Eye, FileText, Fingerprint } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/dialogs/ConfirmDialog';
import { ViewSubmissionDialog } from '@/components/dialogs/ViewSubmissionDialog';
import { ViewSuspiciousReportDialog } from '@/components/dialogs/ViewSuspiciousReportDialog';
import { showToast } from '@/lib/toast';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { DataTable } from '@/components/ui/data-table';
import LoadingSpinner from '@/components/ui/loading-spinner';
import { apiPaths } from '@/lib/api-paths';
import { queryKeys } from '@/lib/query-keys';
import { apiClient } from '@/lib/api/fetch-client';
import { formatDateInTimeZone, zoneAbbrev, parseValidDate } from '@/lib/date-format';
import { useEffectiveTimezone } from '@/hooks/use-effective-timezone';

type SuspiciousReportUser = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  avatar: string | null;
  cropX: number | null;
  cropY: number | null;
  zoom: number | null;
};

type SuspiciousSubmissionMatch = {
  id: string;
  submittedAt: string;
  fileName: string | null;
  originalFileName: string | null;
  isSuspicious: boolean | null;
  isSuspiciousOverride: boolean | null;
  isSuspiciousReason: string | null;
  student: SuspiciousReportUser;
  problem: {
    id: string;
    title: string | null;
    type: string | null;
  };
  studentGroup: { id: string; name: string } | null;
};

type SuspiciousSubmissionRow = {
  id: string;
  submittedAt: string;
  fileName: string | null;
  originalFileName: string | null;
  isSuspicious: boolean | null;
  isSuspiciousOverride: boolean | null;
  isSuspiciousReason: string | null;
  similarityReportJson?: unknown;
  fileHashUsers?: SuspiciousReportUser[];
  calcHashUsers?: SuspiciousReportUser[];
  fileHashSubmissions?: SuspiciousSubmissionMatch[];
  calcHashSubmissions?: SuspiciousSubmissionMatch[];
  student: SuspiciousReportUser;
  problem: {
    id: string;
    title: string | null;
    type: string | null;
  };
  studentGroup: { id: string; name: string } | null;
};

type DialogAction = 'viewSubmission' | 'viewSuspiciousReport' | 'notSuspicious';

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
  const [dialogState, setDialogState] = useState<{
    open: boolean;
    action: DialogAction | null;
    row: SuspiciousSubmissionRow | null;
  }>({ open: false, action: null, row: null });

  const openDialog = (action: DialogAction, row: SuspiciousSubmissionRow) =>
    setDialogState({ open: true, action, row });
  const closeDialog = () => setDialogState({ open: false, action: null, row: null });

  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: queryKeys.assignment.similarity(courseId, assignmentId),
    queryFn: async () =>
      apiClient.get<SuspiciousSubmissionRow[]>(
        apiPaths.assignmentSimilarity(courseId, assignmentId),
      ),
    enabled: !!courseId && !!assignmentId,
    staleTime: 30_000,
  });

  const handleConfirmNotSuspicious = async () => {
    const row = dialogState.row;
    if (!row) return;

    try {
      await apiClient.patch(apiPaths.submission(row.id), {
        isSuspiciousOverride: false,
      });
      showToast.success('Submission marked as not suspicious.');
      closeDialog();
      await queryClient.invalidateQueries({
        queryKey: queryKeys.assignment.similarity(courseId, assignmentId),
      });
    } catch (error) {
      showToast.error(
        error instanceof Error ? error.message : 'Failed to mark submission as not suspicious.',
      );
    }
  };

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
        meta: { priority: 1, rowHeader: true, align: 'left' },
      },
      {
        accessorKey: 'problem.title',
        header: 'Problem',
        cell: ({ row }) => row.original.problem.title ?? 'Unknown',
        meta: { priority: 2, align: 'left' },
      },
      {
        accessorKey: 'submittedAt',
        header: 'Submitted',
        cell: ({ row }) => formatSubmittedAt(row.original.submittedAt, timezone),
        meta: { priority: 2, align: 'left' },
      },
      {
        header: 'File',
        accessorFn: (row) => row.originalFileName ?? row.fileName ?? 'Unknown',
        cell: ({ row }) => row.original.originalFileName ?? row.original.fileName ?? '—',
        meta: { priority: 3, align: 'left' },
      },
      {
        id: 'file',
        header: 'File',
        cell: ({ row }) => {
          const fileName = row.original.fileName;
          if (!fileName) {
            return <span className="text-muted-foreground">—</span>;
          }

          const href = apiPaths.files.submission(encodeURIComponent(fileName));
          const downloadName = row.original.originalFileName ?? fileName;

          return (
            <Button variant="secondary" size="sm" asChild>
              <a href={href} download={downloadName} aria-label={`Download ${downloadName}`}>
                <Download />
              </a>
            </Button>
          );
        },
        meta: { priority: 4, align: 'left' },
      },
      {
        id: 'manage',
        header: 'Manage',
        cell: ({ row }) => (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="secondary" aria-label={`Manage submission ${row.original.id}`}>
                <ChevronDown />
                Manage
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel className="flex items-center gap-2">
                <FileText className="h-4 w-4" />
                {row.original.problem.title ?? 'Submission'}
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => openDialog('viewSubmission', row.original)}
                className="flex items-center gap-2"
              >
                <Eye className="mr-2 h-4 w-4" />
                View Submission
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => openDialog('viewSuspiciousReport', row.original)}
                className="flex items-center gap-2"
              >
                <AlertTriangle className="mr-2 h-4 w-4" />
                View Suspicious Report
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => openDialog('notSuspicious', row.original)}
                variant="destructive"
                className="flex items-center gap-2"
              >
                <CheckCircle className="mr-2 h-4 w-4" />
                Not Suspicious
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ),
        meta: { priority: 4, align: 'left' },
      },
    ],
    [timezone],
  );

  return (
    <div className="space-y-4 w-full max-w-6xl">
      <div className="space-y-1">
        <div className="flex items-center gap-2 text-2xl font-semibold">
          <Fingerprint className="h-6 w-6" />
          <h2>Suspicious Submissions</h2>
        </div>
        <p className="text-muted-foreground max-w-3xl text-sm">
          Review submissions flagged by the similarity detector and decide whether they require follow-up.
        </p>
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
        <>
          <DataTable
            columns={columns}
            data={query.data ?? []}
            loading={query.isFetching}
            tableLabel="Suspicious submissions"
            showToolbar={false}
            emptyTitle="No matches"
            emptyDescription="No submissions have been flagged as suspicious for this assignment."
          />
          <ViewSubmissionDialog
            open={dialogState.open && dialogState.action === 'viewSubmission'}
            onOpenChange={(open) => !open && closeDialog()}
            submission={dialogState.row}
          />
          <ViewSuspiciousReportDialog
            open={dialogState.open && dialogState.action === 'viewSuspiciousReport'}
            onOpenChange={(open) => !open && closeDialog()}
            report={dialogState.row}
          />
          <ConfirmDialog
            open={dialogState.open && dialogState.action === 'notSuspicious'}
            title="Mark submission not suspicious?"
            description="This will override the suspicious flag for this submission."
            confirmText="Confirm"
            cancelText="Cancel"
            variant="destructive"
            onConfirm={handleConfirmNotSuspicious}
            onCancel={closeDialog}
          />
        </>
      )}
    </div>
  );
}
