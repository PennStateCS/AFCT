'use client';

import type { ColumnDef } from '@tanstack/react-table';
import { Download, FileText, MessageSquare, RotateCcw } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { DataTable } from '@/components/ui/data-table';
import ProblemHeader from '@/components/ProblemHeader';
import ProblemGradeForm from '@/components/ProblemGradeForm';
import WorkspacePanel from '@/components/WorkspacePanel';
import ProblemDiscussionPanel from '@/components/ProblemDiscussionPanel';
import type { Comment as DiscussionComment } from '@/components/DiscussionPanel';
import type { StudentProblemComment } from '@/lib/assignment-details';
import type { ProblemSubmission } from '@/lib/problem-submission';
import { apiPaths } from '@/lib/api-paths';
import {
  statusToneClass,
  getTimingStatusChip,
  getReviewStatusChip,
  type StatusChip,
} from '@/lib/submission-status';
import { formatDateInTimeZone, formatTimeInTimeZone } from '@/lib/date-format';
import { useEffectiveTimezone } from '@/hooks/use-effective-timezone';

type Problem = {
  id: string;
  title: string;
  description?: string | null;
  type?: string | null;
  maxPoints?: number | null;
  maxStates?: number | null;
  isDeterministic?: boolean | null;
  maxSubmissions?: number | null;
  autograderEnabled?: boolean | null;
  fileName?: string | null;
  originalFileName?: string | null;
  problemId?: string | null;
};

type ProblemWorkspaceComment = DiscussionComment | StudentProblemComment;

export type ProblemWorkspaceProps = {
  problem: Problem | null;
  submissions: ProblemSubmission[];
  assignmentDueDate?: string | Date | null;
  /** Group assignment: show a "Submitted by" column naming the member who submitted. */
  showSubmitter?: boolean;
  comments: ProblemWorkspaceComment[];
  commentText: string;
  onCommentTextChange: (text: string) => void;
  onSaveComment: () => void;
  onDeleteComment?: (id: string) => void;
  isSaving?: boolean;
  deletingComments?: Record<string, boolean>;
  onViewSubmission: (submission: ProblemSubmission) => void;
  onRerunSubmission?: (submission: ProblemSubmission) => void;
  rerunning?: Record<string, boolean>;
  courseIsArchived: boolean;
  gradeInput?: string;
  currentGrade?: number | null;
  gradeError?: string | null;
  onGradeInputChange?: (value: string) => void;
  onSaveGrade?: () => void;
  isSavingGrade?: boolean;
  isLoadingGrade?: boolean;
  isPrivilegedUser: boolean;
  submissionsLoading?: boolean;
  commentsLoading?: boolean;
};

const normalizeComments = (comments: ProblemWorkspaceComment[]): DiscussionComment[] =>
  comments.map((comment) => {
    if ('author' in comment) {
      return comment;
    }

    const [firstName, ...rest] = (comment.authorName ?? '').split(' ');
    return {
      id: comment.id,
      content: comment.content,
      createdAt: comment.createdAt,
      author: {
        id: comment.authorId ?? undefined,
        firstName: firstName || null,
        lastName: rest.length > 0 ? rest.join(' ') : null,
        role: comment.authorRole ?? null,
        avatar: null,
        avatarUrl: null,
      },
    };
  });

export default function ProblemWorkspace({
  problem,
  submissions,
  assignmentDueDate,
  showSubmitter = false,
  comments,
  commentText,
  onCommentTextChange,
  onSaveComment,
  onDeleteComment,
  isSaving = false,
  deletingComments = {},
  onViewSubmission,
  onRerunSubmission,
  courseIsArchived,
  gradeInput = '',
  currentGrade = null,
  gradeError = null,
  onGradeInputChange,
  onSaveGrade,
  isSavingGrade = false,
  isLoadingGrade = false,
  isPrivilegedUser,
  submissionsLoading = false,
  commentsLoading = false,
}: ProblemWorkspaceProps) {
  // Render each submission's date/time in the course/effective timezone (not the
  // reviewer's browser locale), so the time shown is the one that student submitted at.
  const { timezone, hour12 } = useEffectiveTimezone();

  if (!problem) {
    return (
      <Card>
        <CardContent className="text-muted-foreground p-6 text-sm">
          Select a problem to view submissions.
        </CardContent>
      </Card>
    );
  }

  const normalizedComments = normalizeComments(comments);
  const handleDeleteComment = onDeleteComment ?? (() => {});
  const dueDate = assignmentDueDate ? new Date(assignmentDueDate) : null;
  const hasValidDueDate = !!dueDate && !Number.isNaN(dueDate.getTime());

  const sortedSubmissions = [...submissions].sort(
    (a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime(),
  );

  const handleDownload = (submission: ProblemSubmission) => {
    if (!submission.fileName) return;

    const url = apiPaths.files.submission(encodeURIComponent(submission.fileName));
    const link = document.createElement('a');
    link.href = url;
    link.download = submission.originalFileName || 'Download';
    link.click();
  };

  // A single status chip (dot + label). Status (timing) and Result (evaluator verdict)
  // each render one of these in their own column.
  const renderStatusChip = (chip: StatusChip) => (
    <span className="inline-flex items-center gap-2 text-xs font-medium" title={chip.title}>
      <span
        className={`inline-flex h-2.5 w-2.5 rounded-full ${statusToneClass[chip.tone]}`}
        aria-hidden="true"
      />
      <span>{chip.label}</span>
    </span>
  );

  // Built inline so each cell's action buttons capture the current handlers/flags.
  // Status and Result expose a string accessor + multiselect filter so DataTable's own
  // Filters popover replaces the previous custom status chips.
  const submissionColumns: ColumnDef<ProblemSubmission>[] = [
    {
      id: 'submitted',
      header: 'Submitted',
      accessorFn: (s) => new Date(s.submittedAt).getTime(),
      cell: ({ row }) => {
        const submission = row.original;
        const submittedAt = new Date(submission.submittedAt);
        const isLate =
          submission.status?.toLowerCase() === 'late' ||
          (hasValidDueDate && submittedAt.getTime() > dueDate!.getTime());
        return (
          <div className="flex flex-col gap-1">
            <span>{formatDateInTimeZone(submittedAt, timezone)}</span>
            <span className="text-muted-foreground text-xs">
              {formatTimeInTimeZone(submittedAt, timezone, hour12)}
            </span>
            {isLate ? (
              <Badge
                variant="secondary"
                className="mt-1 inline-flex items-center rounded-full bg-status-warning-bg px-2 py-1 text-xs font-semibold text-status-warning shadow-sm"
              >
                Late
              </Badge>
            ) : null}
          </div>
        );
      },
      meta: { priority: 1 },
    },
    ...(showSubmitter
      ? [
          {
            id: 'submittedBy',
            header: 'Submitted by',
            accessorFn: (s: ProblemSubmission) =>
              typeof s.submittedBy === 'string' ? s.submittedBy : '',
            cell: ({ row }: { row: { original: ProblemSubmission } }) =>
              typeof row.original.submittedBy === 'string' ? row.original.submittedBy : '—',
            meta: { priority: 2 },
          } as ColumnDef<ProblemSubmission>,
        ]
      : []),
    {
      id: 'status',
      header: 'Status',
      accessorFn: (s) => getTimingStatusChip(s, hasValidDueDate, dueDate).label,
      enableSorting: false,
      cell: ({ row }) =>
        renderStatusChip(getTimingStatusChip(row.original, hasValidDueDate, dueDate)),
      meta: {
        priority: 1,
        filterVariant: 'multiselect',
        filterLabel: 'Status',
        filterOptions: [
          { label: 'On time', value: 'On time' },
          { label: 'Late', value: 'Late' },
        ],
      },
    },
    {
      id: 'result',
      header: 'Result',
      accessorFn: (s) => getReviewStatusChip(s).label,
      enableSorting: false,
      cell: ({ row }) => renderStatusChip(getReviewStatusChip(row.original)),
      meta: {
        priority: 1,
        filterVariant: 'multiselect',
        filterLabel: 'Result',
        filterOptions: [
          { label: 'Pending', value: 'Pending' },
          { label: 'Processing', value: 'Processing' },
          { label: 'Failed', value: 'Failed' },
          { label: 'Correct', value: 'Correct' },
          { label: 'Incorrect', value: 'Incorrect' },
        ],
      },
    },
    {
      id: 'feedback',
      header: 'Feedback',
      enableSorting: false,
      cell: ({ row }) => {
        const feedback = row.original.feedback;
        if (!feedback) return <span className="text-muted-foreground">—</span>;
        // TableCell bakes in whitespace-nowrap; override it here so long evaluator
        // output wraps (and keeps its own line breaks) inside a bounded width.
        return (
          <div className="max-w-[28rem] text-xs whitespace-pre-wrap break-words">
            {String(feedback)}
          </div>
        );
      },
      meta: { priority: 2 },
    },
    {
      id: 'file',
      header: 'File',
      enableSorting: false,
      cell: ({ row }) => {
        const submission = row.original;
        if (!submission.fileName) return <span className="text-muted-foreground">—</span>;
        const pendingOrProcessing =
          submission.status?.toLowerCase() === 'pending' ||
          submission.status?.toLowerCase() === 'processing';
        return (
          <div className="flex items-center gap-2">
            {/* Click the name to preview; the icons download and (for staff) rerun. */}
            <button
              type="button"
              onClick={() => onViewSubmission(submission)}
              className="text-primary break-all hover:underline"
              title={`Preview ${submission.originalFileName || 'submission'}`}
            >
              {submission.originalFileName || submission.fileName}
            </button>
            <button
              type="button"
              onClick={() => handleDownload(submission)}
              className="text-muted-foreground hover:text-foreground shrink-0"
              title={`Download ${submission.originalFileName || 'submission'}`}
              aria-label={`Download ${submission.originalFileName || 'submission'}`}
            >
              <Download className="h-4 w-4" aria-hidden="true" />
            </button>
            {isPrivilegedUser ? (
              <button
                type="button"
                onClick={() => onRerunSubmission?.(submission)}
                disabled={pendingOrProcessing}
                className="text-muted-foreground hover:text-foreground shrink-0 disabled:pointer-events-none disabled:opacity-50"
                title="Rerun submission"
                aria-label="Rerun submission"
              >
                <RotateCcw className="h-4 w-4" aria-hidden="true" />
              </button>
            ) : null}
          </div>
        );
      },
      meta: { priority: 2 },
    },
  ];

  return (
    <div className="space-y-4 print:space-y-2">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <ProblemHeader
            className="min-w-0 lg:flex-1"
            title={problem.title}
            description={problem.description ?? undefined}
            descriptionJson={(problem as { descriptionJson?: unknown }).descriptionJson}
            type={problem.type ?? undefined}
            maxStates={problem.maxStates ?? undefined}
            isDeterministic={problem.isDeterministic ?? undefined}
            maxSubmissions={problem.maxSubmissions ?? undefined}
            autograderEnabled={problem.autograderEnabled ?? undefined}
          />

          {isPrivilegedUser && onGradeInputChange && onSaveGrade ? (
            <ProblemGradeForm
              value={gradeInput}
              currentGrade={currentGrade}
              maxPoints={problem.maxPoints}
              disabled={courseIsArchived}
              isSaving={isSavingGrade}
              isLoading={isLoadingGrade}
              error={gradeError}
              onChange={onGradeInputChange}
              onSubmit={onSaveGrade}
              autograderStatus={submissions[0]?.status ?? null}
              // `submissions[0]!` preserves the prior pass-through exactly; `!` is
              // compile-only so runtime behavior is unchanged.
              onRerun={onRerunSubmission ? () => onRerunSubmission(submissions[0]!) : undefined}
            />
          ) : !isPrivilegedUser ? (
            <div className="inline-flex items-center gap-2 rounded-full border border-border bg-transparent px-3 py-2 text-xs whitespace-nowrap text-foreground">
              <span className="font-semibold tracking-[0.16em] uppercase">Grade</span>
              <span>
                {currentGrade !== null ? currentGrade : '-'} / {problem.maxPoints}
              </span>
            </div>
          ) : null}
        </div>

      <div className="grid items-stretch gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <WorkspacePanel
            title="Submissions"
            icon={<FileText className="h-4 w-4" />}
            className="h-full"
            contentClassName="p-2"
          >
            {submissionsLoading ? (
              <div
                role="status"
                className="flex min-h-[320px] flex-col items-center justify-center gap-3"
              >
                <div
                  aria-hidden="true"
                  className="border-muted-foreground/30 border-t-primary h-8 w-8 animate-spin rounded-full border-4"
                />
                <p className="text-muted-foreground text-sm">Loading submissions...</p>
              </div>
            ) : sortedSubmissions.length > 0 ? (
              <DataTable
                columns={submissionColumns}
                data={sortedSubmissions}
                storageKey="problem-submissions"
                tableLabel="Submissions"
                showExportButton={false}
                defaultSorting={[{ id: 'submitted', desc: true }]}
                emptyTitle="No submissions match the filters"
                emptyDescription="Adjust the filters to see more."
                emptyIcon={FileText}
              />
            ) : (
              <div className="text-muted-foreground space-y-2 rounded-md border border-dashed p-4 text-center text-sm">
                <p>No submissions yet.</p>
              </div>
            )}
          </WorkspacePanel>

          <WorkspacePanel
            title={`Discussion (${normalizedComments.length})`}
            icon={<MessageSquare className="h-4 w-4" />}
          >
            {commentsLoading ? (
              <div role="status" className="text-muted-foreground text-sm">
                Loading discussion...
              </div>
            ) : (
              <ProblemDiscussionPanel
                courseIsArchived={courseIsArchived}
                comments={normalizedComments}
                commentText={commentText}
                onCommentTextChange={onCommentTextChange}
                onSaveComment={onSaveComment}
                onDeleteComment={handleDeleteComment}
                isSaving={isSaving}
                deletingComments={deletingComments}
              />
            )}
          </WorkspacePanel>
        </div>
    </div>
  );
}
