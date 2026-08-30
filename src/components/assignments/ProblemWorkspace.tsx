'use client';

import type { ColumnDef } from '@tanstack/react-table';
import { useState } from 'react';
import {
  ChevronUp,
  ClipboardCheck,
  Download,
  MoreHorizontal,
  FileText,
  MessageSquare,
  RotateCcw,
  Users,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import { StatusBadge } from '@/components/ui/status-badge';
import { DataTable } from '@/components/ui/data-table';
import ProblemHeader from '@/components/ProblemHeader';
import ProblemGradeForm from '@/components/ProblemGradeForm';
import { GradeHoldControl } from '@/components/GradeHoldControl';
import { DataTableLoading } from '@/components/ui/data-table-status';
import ProblemDiscussionPanel from '@/components/ProblemDiscussionPanel';
import type { GradeAudience } from '@/components/ProblemGradeForm';
import type { Comment as DiscussionComment, CommentAudience } from '@/components/DiscussionPanel';
import type { StudentProblemComment } from '@/lib/assignment-details';
import type { ProblemSubmission } from '@/lib/problem-submission';
import { apiPaths } from '@/lib/api-paths';
import { getTimingStatusChip, getReviewStatusChip, type StatusChip } from '@/lib/submission-status';
import { formatDateInTimeZone, formatTimeInTimeZone } from '@/lib/date-format';
import { useEffectiveTimezone } from '@/hooks/use-effective-timezone';
import { GradeSyncCard } from '@/components/assignments/GradeSyncCard';
import { TEXT_LINK_CLASS } from '@/lib/link-styles';
import { cn } from '@/lib/utils';
import { FEEDBACK_WITHHELD_MESSAGE } from '@/lib/feedback-visibility';

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
  /** Whether this grade is held, so the autograder will leave it alone. */
  gradedManually?: boolean;
  /** Who produced the grade. Not derivable from the hold above; see `lib/grade-hold`. */
  gradeSource?: 'AUTOGRADER' | 'MANUAL';
  /** Hold the grade against the autograder, or hand it back. */
  onManualHoldChange?: (held: boolean) => void;
  /** The group whose work this is, on a group assignment. */
  group?: { id: string; name: string } | null;
  /** The other members of that group. */
  groupMembers?: { id: string; firstName: string | null; lastName: string | null }[];
  /** Group assignments only: who a saved grade applies to. */
  gradeAudience?: GradeAudience | null;
  /** The value this student's group was given, when the grade came from one. */
  groupGradeValue?: number | null;
  isSavingGrade?: boolean;
  isLoadingGrade?: boolean;
  isPrivilegedUser: boolean;
  /** Set by the staff view only. Enables the LMS grade entry below the grade form. */
  assignmentId?: string;
  /** Whose work is open, so the LMS panel reports and sends this student's grade alone. */
  studentId?: string | null;
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
  gradeSource = 'AUTOGRADER',
  onManualHoldChange,
  group = null,
  groupMembers,
  gradeAudience,
  groupGradeValue,
  isSavingGrade = false,
  isLoadingGrade = false,
  isPrivilegedUser,
  assignmentId,
  studentId,
  submissionsLoading = false,
  commentsLoading = false,
}: ProblemWorkspaceProps) {
  const [discussionOpen, setDiscussionOpen] = useState(true);
  const [membersOpen, setMembersOpen] = useState(false);
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

  /**
   * What the latest attempt currently says, as one sentence.
   *
   * The verdict and the evaluator's feedback live in table cells, and a cell changing in place
   * announces nothing: a submission went from Pending to Incorrect, and a counterexample
   * appeared in a row the reader had already passed, in silence. This is the one place that
   * says so out loud.
   *
   * Scoped to the newest attempt on purpose. Putting `aria-live` on the table would re-announce
   * the whole thing on every sort, filter and page change, which is how a live region becomes
   * something people turn off.
   */
  const latest = sortedSubmissions[0];
  const latestStatus = latest
    ? `Attempt ${attemptNumbers.get(latest.id) ?? sortedSubmissions.length}: ${
        getReviewStatusChip(latest).label
      }.${
        latest.feedbackVisible === false
          ? ` ${FEEDBACK_WITHHELD_MESSAGE}`
          : latest.feedback
            ? ` ${String(latest.feedback)}`
            : ''
      }`
    : '';

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
              <Badge variant="warning" className="mt-1">
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
        // Withheld and empty are different things, and the dash alone says the wrong one: a
        // student would read it as the evaluator having had nothing to tell them.
        if (row.original.feedbackVisible === false)
          return <span className="text-muted-foreground text-xs">{FEEDBACK_WITHHELD_MESSAGE}</span>;
        if (!feedback)
          return (
            <span className="text-muted-foreground">
              <span aria-hidden="true">—</span>
              <span className="sr-only">No feedback</span>
            </span>
          );
        // TableCell bakes in whitespace-nowrap; override it here so long evaluator
        // output wraps (and keeps its own line breaks) inside a bounded width.
        return (
          <div className="max-w-[28rem] text-xs break-words whitespace-pre-wrap">
            {String(feedback)}
          </div>
        );
      },
      /*
       * Priority 1, not 2.
       * Priority 2 hides a column below 768px, and this table becomes cards below 640px, so
       * between those two widths the cell was removed from the page altogether with no card
       * to fall back on. A student in a half-width window lost the counterexample and the link
       * to their own submission, with nothing saying either existed. This table carries a
       * handful of attempts for one problem, so it has the room.
       */
      meta: { priority: 1 },
    },
    {
      id: 'file',
      header: 'File',
      enableSorting: false,
      cell: ({ row }) => {
        const submission = row.original;
        if (!submission.fileName)
          return (
            <span className="text-muted-foreground">
              <span aria-hidden="true">—</span>
              <span className="sr-only">No file</span>
            </span>
          );
        return (
          // The name previews; everything else lives in the row's menu.
          <button
            type="button"
            onClick={() => onViewSubmission(submission)}
            className={cn(TEXT_LINK_CLASS, 'break-all')}
            title={`Preview ${submission.originalFileName || 'submission'}`}
          >
            {submission.originalFileName || submission.fileName}
          </button>
        );
      },
      /*
       * Priority 1, not 2.
       * Priority 2 hides a column below 768px, and this table becomes cards below 640px, so
       * between those two widths the cell was removed from the page altogether with no card
       * to fall back on. A student in a half-width window lost the counterexample and the link
       * to their own submission, with nothing saying either existed. This table carries a
       * handful of attempts for one problem, so it has the room.
       */
      meta: { priority: 1 },
    },
    {
      id: 'actions',
      header: '',
      enableSorting: false,
      cell: ({ row }) => {
        const submission = row.original;
        if (!submission.fileName) return null;
        // A re-run while one is already queued or running would do nothing useful, so the
        // item is disabled rather than hidden: the action still reads as available in
        // general, just not right now.
        const pendingOrProcessing =
          submission.status?.toLowerCase() === 'pending' ||
          submission.status?.toLowerCase() === 'processing';
        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Attempt actions">
                <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => handleDownload(submission)}>
                <Download className="h-4 w-4" aria-hidden="true" />
                Download file
              </DropdownMenuItem>
              {isPrivilegedUser ? (
                <DropdownMenuItem
                  disabled={pendingOrProcessing}
                  onClick={() => onRerunSubmission?.(submission)}
                >
                  <RotateCcw className="h-4 w-4" aria-hidden="true" />
                  Rerun the autograder
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        );
      },
      meta: { align: 'right' },
    },
  ];

  return (
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,70fr)_minmax(0,30fr)] lg:items-stretch print:block print:space-y-2">
      {/* Two matching cards: what the problem is and the work submitted for it, beside what
          you are doing about it. */}
      <div className="bg-card flex min-w-0 flex-col gap-4 rounded-md border p-4 lg:h-full">
        <div className="flex items-center gap-2">
          <FileText className="text-muted-foreground h-4 w-4" aria-hidden="true" />
          <h3 className="text-sm font-medium">Problem Attempts</h3>
          {/* Across from the heading, matching the menu opposite in Problem Grade. */}
          {isPrivilegedUser ? <div className="ml-auto">{submissionsAction}</div> : null}
        </div>
        <ProblemHeader
          className="min-w-0"
          action={
            isPrivilegedUser ? null : (
              // A readout, not a state: it says what the grade is, so it stays quiet and
              // takes the same geometry as the problem facts immediately below it.
              <Badge variant="outline" className="gap-2 px-3 py-2">
                <span className="font-semibold tracking-widest uppercase">Grade</span>
                <span>
                  {currentGrade !== null ? currentGrade : '-'} / {problem.maxPoints}
                </span>
              </Badge>
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

        {/*
          Always mounted, empty when there is nothing to say. A live region inserted together
          with its first message is not reliably announced, so it has to be here before the
          answer is.
        */}
        <div role="status" aria-live="polite" className="sr-only">
          {latestStatus}
        </div>

        {/* No panel around the table: it carries its own toolbar, column headers and pager,
              so a band above it repeating "Submissions" on the Submissions tab added a frame
              and a word without adding information. `tableLabel` still names it for assistive
              tech, and the grant action sits with the table's other controls. */}
        {submissionsLoading ? (
          <DataTableLoading
            message="Loading submissions, please wait..."
            className="min-h-[320px]"
          />
        ) : sortedSubmissions.length > 0 ? (
          <DataTable
            columns={submissionColumns}
            data={sortedSubmissions}
            storageKey="problem-submissions"
            tableLabel="Problem attempts"
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
      <div className="bg-card flex min-w-0 flex-col gap-4 rounded-md border p-4 lg:h-full">
        {isPrivilegedUser && onGradeInputChange && onSaveGrade ? (
          <div className="flex flex-col gap-2 border-b pb-4">
            <div className="flex items-center gap-2">
              <ClipboardCheck className="text-muted-foreground h-4 w-4" aria-hidden="true" />
              <h3 className="text-sm font-medium">Problem Grade</h3>
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
            />
            {/* Renders nothing unless the course is linked to an LMS. */}
            {assignmentId ? (
              <GradeSyncCard assignmentId={assignmentId} variant="inline" studentId={studentId} />
            ) : null}
            {/* Under the grade rather than beside the heading: it needs a sentence to
                    mean anything, and the sentence is the part the old switch was missing. */}
            {onManualHoldChange ? (
              <GradeHoldControl
                autograderEnabled={!!problem.autograderEnabled}
                gradeSource={gradeSource}
                gradedManually={gradedManually}
                hasGrade={currentGrade !== null && currentGrade !== undefined}
                onChange={onManualHoldChange}
                disabled={courseIsArchived}
                className="mt-1"
              />
            ) : null}
          </div>
        ) : null}
        {group ? (
          <div className="flex flex-col gap-1 border-b pb-4">
            <div className="flex items-center gap-2">
              <Users className="text-muted-foreground h-4 w-4" aria-hidden="true" />
              <h3 className="text-sm font-medium">
                {group.name} · {(groupMembers?.length ?? 0) + 1}{' '}
                {(groupMembers?.length ?? 0) + 1 === 1 ? 'member' : 'members'}
              </h3>
              {/* Collapsed by default: the count in the heading answers the usual
                      question, and the names are only needed when something looks wrong. */}
              <button
                type="button"
                onClick={() => setMembersOpen((open) => !open)}
                aria-expanded={membersOpen}
                aria-controls="group-members"
                className="text-muted-foreground hover:text-foreground ml-auto rounded p-1"
              >
                <ChevronUp
                  className={`h-4 w-4 transition-transform ${membersOpen ? '' : 'rotate-180'}`}
                  aria-hidden="true"
                />
                <span className="sr-only">
                  {membersOpen ? 'Collapse members' : 'Expand members'}
                </span>
              </button>
            </div>
            {/* The whole group, the student under review included: a list that omitted
                    them would read as "everyone else", which is not who the grade and the
                    thread apply to. */}
            <p id="group-members" hidden={!membersOpen} className="text-muted-foreground text-xs">
              {[
                subjectName ?? 'This student',
                ...(groupMembers ?? []).map(
                  (m) => `${m.firstName ?? ''} ${m.lastName ?? ''}`.trim() || 'Student',
                ),
              ].join(', ')}
            </p>
          </div>
        ) : null}
        <div className="flex items-center gap-2">
          <MessageSquare className="text-muted-foreground h-4 w-4" aria-hidden="true" />
          <h3 className="text-sm font-medium">Problem Discussion ({normalizedComments.length})</h3>
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
          {/* Kept across both branches. It used to be mounted with "Loading discussion..." and
              then replaced wholesale by the panel, so neither the wait nor its end announced. */}
          <span role="status" aria-live="polite" className="sr-only">
            {commentsLoading ? 'Loading the discussion.' : 'Discussion loaded.'}
          </span>
          {commentsLoading ? (
            <div className="text-muted-foreground text-sm" aria-hidden="true">
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
