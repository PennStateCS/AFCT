'use client';

import type { ColumnDef } from '@tanstack/react-table';
import { useState } from 'react';
import {
  ChevronUp,
  ClipboardCheck,
  Download,
  FileText,
  MessageSquare,
  RotateCcw,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { StatusBadge } from '@/components/ui/status-badge';
import { Switch } from '@/components/ui/switch';
import { DataTable } from '@/components/ui/data-table';
import ProblemHeader from '@/components/ProblemHeader';
import ProblemGradeForm from '@/components/ProblemGradeForm';
import { DataTableLoading } from '@/components/ui/data-table-status';
import ProblemDiscussionPanel from '@/components/ProblemDiscussionPanel';
import type { GradeAudience } from '@/components/ProblemGradeForm';
import type {
  Comment as DiscussionComment,
  CommentAudience,
} from '@/components/DiscussionPanel';
import type { StudentProblemComment } from '@/lib/assignment-details';
import type { ProblemSubmission } from '@/lib/problem-submission';
import { apiPaths } from '@/lib/api-paths';
import {
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
  /** Group assignments only: who a new comment reaches. */
  commentAudience?: CommentAudience | null;
  subjectName?: string;
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
  /** Control shown in the Submissions panel header, e.g. granting extra attempts. */
  submissionsAction?: React.ReactNode;
  /** Whether a person set this grade, so the autograder will leave it alone. */
  gradedManually?: boolean;
  /** Hold the grade against the autograder, or hand it back. */
  onManualHoldChange?: (held: boolean) => void;
  /** Group assignments only: who a saved grade applies to. */
  gradeAudience?: GradeAudience | null;
  /** The value this student's group was given, when the grade came from one. */
  groupGradeValue?: number | null;
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
  commentAudience,
  subjectName,
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
  submissionsAction,
  gradedManually = false,
  onManualHoldChange,
  gradeAudience,
  groupGradeValue,
  isSavingGrade = false,
  isLoadingGrade = false,
  isPrivilegedUser,
  submissionsLoading = false,
  commentsLoading = false,
}: ProblemWorkspaceProps) {
  const [discussionOpen, setDiscussionOpen] = useState(true);
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

  const attemptNumbers = new Map<string, number>();
  [...submissions]
    .sort((a, b) => new Date(a.submittedAt).getTime() - new Date(b.submittedAt).getTime())
    .forEach((s, i) => attemptNumbers.set(s.id, i + 1));

  const sortedSubmissions = [...submissions].sort(
    (a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime(),
  );

  const handleDownload = (submission: ProblemSubmission) => {
    if (!submission.fileName) return;

    const url = apiPaths.files.submission(encodeURIComponent(submission.fileName), {
      download: true,
    });
    const link = document.createElement('a');
    link.href = url;
    link.download = submission.originalFileName || 'Download';
    link.click();
  };

  // Status (timing) and Result (evaluator verdict) each render one of these. StatusBadge
  // takes its colour from the chip's own variant, so the label and its colour are decided in
  // lib/submission-status rather than per table, and a dot conveying meaning by colour alone
  // is replaced by a badge whose text carries it.
  const renderStatusChip = (chip: StatusChip) => <StatusBadge chip={chip} />;

  // Built inline so each cell's action buttons capture the current handlers/flags.
  // Status and Result expose a string accessor + multiselect filter so DataTable's own
  // Filters popover replaces the previous custom status chips.
  const submissionColumns: ColumnDef<ProblemSubmission>[] = [
    {
      id: 'attempt',
      header: 'Attempt',
      accessorFn: (s) => attemptNumbers.get(s.id) ?? 0,
      cell: ({ row }) => (
        <span className="tabular-nums">{attemptNumbers.get(row.original.id) ?? '—'}</span>
      ),
      meta: { align: 'center' },
    },
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
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,70fr)_minmax(0,30fr)] print:block print:space-y-2">
      {/* Two matching cards: what the problem is and the work submitted for it, beside what
          you are doing about it. */}
      <div className="bg-card flex min-w-0 flex-col gap-4 rounded-md border p-4">
          <ProblemHeader
            className="min-w-0"
            action={
              isPrivilegedUser ? (
                submissionsAction
              ) : (
                <div className="border-border text-foreground inline-flex items-center gap-2 rounded-full border bg-transparent px-3 py-2 text-xs whitespace-nowrap">
                  <span className="font-semibold tracking-[0.16em] uppercase">Grade</span>
                  <span>
                    {currentGrade !== null ? currentGrade : '-'} / {problem.maxPoints}
                  </span>
                </div>
              )
            }
            title={problem.title}
            description={problem.description ?? undefined}
            descriptionJson={(problem as { descriptionJson?: unknown }).descriptionJson}
            type={problem.type ?? undefined}
            maxStates={problem.maxStates ?? undefined}
            isDeterministic={problem.isDeterministic ?? undefined}
            maxSubmissions={problem.maxSubmissions ?? undefined}
            autograderEnabled={problem.autograderEnabled ?? undefined}
          />

          <h3 className="text-sm font-medium">Attempts</h3>
          {/* No panel around the table: it carries its own toolbar, column headers and pager,
              so a band above it repeating "Submissions" on the Submissions tab added a frame
              and a word without adding information. `tableLabel` still names it for assistive
              tech, and the grant action sits with the table's other controls. */}
          {submissionsLoading ? (
            <DataTableLoading message="Loading submissions, please wait..." className="min-h-[320px]" />
          ) : sortedSubmissions.length > 0 ? (
            <DataTable
              columns={submissionColumns}
              data={sortedSubmissions}
              storageKey="problem-submissions"
              tableLabel="Attempts"
              // A handful of attempts for one student on one problem: search, filters and a
              // column picker are more chrome than the data underneath them.
              showToolbar={false}
              showExportButton={false}
              defaultSorting={[{ id: 'submitted', desc: true }]}
              emptyTitle="No attempts match the filters"
              emptyDescription="Adjust the filters to see more."
              emptyIcon={FileText}
            />
          ) : (
            <div className="text-muted-foreground rounded-md border border-dashed p-4 text-sm">
              No attempts yet.
            </div>
          )}
      </div>

          {/* Right column: what you are doing about this student's work. */}
          <div className="bg-card flex min-w-0 flex-col gap-4 rounded-md border p-4">
            {isPrivilegedUser && onGradeInputChange && onSaveGrade ? (
              <div className="flex flex-col gap-2 border-b pb-4">
                <div className="flex items-center gap-2">
                  <ClipboardCheck className="text-muted-foreground h-4 w-4" aria-hidden="true" />
                  <h3 className="text-sm font-medium">Problem Grade</h3>
                  {/* Only meaningful where the autograder would otherwise write this grade.
                      On a hand-graded problem every grade is manual and the switch would be
                      a control with nothing on the other side of it. */}
                  {problem.autograderEnabled && onManualHoldChange ? (
                    <label className="text-muted-foreground ml-auto flex items-center gap-2 text-xs">
                      <span>Manual override</span>
                      <Switch
                        checked={gradedManually}
                        onCheckedChange={(v) => onManualHoldChange(!!v)}
                        disabled={courseIsArchived}
                        aria-label="Hold this grade against the autograder"
                      />
                    </label>
                  ) : null}
                </div>
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
                  audience={gradeAudience}
                  groupGradeValue={groupGradeValue}
                  autograderStatus={submissions[0]?.status ?? null}
                  // `submissions[0]!` preserves the prior pass-through exactly; `!` is
                  // compile-only so runtime behavior is unchanged.
                  onRerun={
                    onRerunSubmission ? () => onRerunSubmission(submissions[0]!) : undefined
                  }
                />
              </div>
            ) : null}
            <div className="flex items-center gap-2">
              <MessageSquare className="text-muted-foreground h-4 w-4" aria-hidden="true" />
              <h3 className="text-sm font-medium">
                Problem Discussion ({normalizedComments.length})
              </h3>
              {/* Collapsing gets the composer out of the way when a grader is reading rather
                  than replying. aria-expanded and aria-controls carry the state, so it is not
                  a chevron whose meaning only a sighted user can infer. */}
              <button
                type="button"
                onClick={() => setDiscussionOpen((open) => !open)}
                aria-expanded={discussionOpen}
                aria-controls="problem-discussion"
                className="text-muted-foreground hover:text-foreground ml-auto rounded p-1"
              >
                <ChevronUp
                  className={`h-4 w-4 transition-transform ${discussionOpen ? '' : 'rotate-180'}`}
                  aria-hidden="true"
                />
                <span className="sr-only">
                  {discussionOpen ? 'Collapse discussion' : 'Expand discussion'}
                </span>
              </button>
            </div>
            <div id="problem-discussion" hidden={!discussionOpen}>
            {commentsLoading ? (
              <div role="status" className="text-muted-foreground text-sm">
                Loading discussion...
              </div>
            ) : (
              <ProblemDiscussionPanel
                courseIsArchived={courseIsArchived}
                audience={commentAudience}
                subjectName={subjectName}
                comments={normalizedComments}
                commentText={commentText}
                onCommentTextChange={onCommentTextChange}
                onSaveComment={onSaveComment}
                onDeleteComment={handleDeleteComment}
                isSaving={isSaving}
                deletingComments={deletingComments}
              />
            )}
            </div>
          </div>
    </div>
  );
}
