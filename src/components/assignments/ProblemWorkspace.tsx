'use client';

import { useState } from 'react';
import { Eye, Download, File, FileText, MessageSquare, RotateCcw } from 'lucide-react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { FeedbackDialog } from '@/components/dialogs/FeedbackDialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import ProblemHeader from '@/components/ProblemHeader';
import ProblemGradeForm from '@/components/ProblemGradeForm';
import WorkspacePanel from '@/components/WorkspacePanel';
import ProblemDiscussionPanel from '@/components/ProblemDiscussionPanel';
import type { Comment as DiscussionComment } from '@/components/DiscussionPanel';
import type { StudentProblemComment } from '@/lib/assignment-details';
import type { ProblemSubmission } from '@/lib/problem-submission';
import type { SubmissionStatusFilter } from '@/lib/submission-status-filter';
import { STATUS_FILTER_OPTIONS, filterSubmissions } from '@/lib/submission-status-filter';
import {
  statusToneClass,
  getTimingStatusChip,
  getReviewStatusChip,
} from '@/lib/submission-status';

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
  comments: ProblemWorkspaceComment[];
  commentText: string;
  onCommentTextChange: (text: string) => void;
  onSaveComment: () => void;
  onDeleteComment?: (id: string) => void;
  isSaving?: boolean;
  deletingComments?: Record<string, boolean>;
  onViewSubmission: (submission: any) => void;
  onRerunSubmission?: (submission: any) => void;
  onRerunVisibleSubmissions?: (submissions: ProblemSubmission[]) => void;
  rerunning?: Record<string, boolean>;
  courseIsArchived: boolean;
  gradeInput?: string;
  currentGrade?: number | null;
  gradeError?: string | null;
  onGradeInputChange?: (value: string) => void;
  onSaveGrade?: () => void;
  isSavingGrade?: boolean;
  isLoadingGrade?: boolean;
  isPrivledgedUser: boolean;
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
  comments,
  commentText,
  onCommentTextChange,
  onSaveComment,
  onDeleteComment,
  isSaving = false,
  deletingComments = {},
  onViewSubmission,
  onRerunSubmission,
  onRerunVisibleSubmissions,
  courseIsArchived,
  gradeInput = '',
  currentGrade = null,
  gradeError = null,
  onGradeInputChange,
  onSaveGrade,
  isSavingGrade = false,
  isLoadingGrade = false,
  isPrivledgedUser,
  submissionsLoading = false,
  commentsLoading = false,
}: ProblemWorkspaceProps) {
  const [feedbackDialogOpen, setFeedbackDialogOpen] = useState(false);
  const [isRunning, _setIsRunning] = useState(false);
  const [activeFeedback, setActiveFeedback] = useState<string | null>(null);
  const [activeFilters, setActiveFilters] = useState<Set<SubmissionStatusFilter>>(new Set());

  const toggleFilter = (f: SubmissionStatusFilter) => {
    setActiveFilters((prev) => {
      const next = new Set(prev);
      if (next.has(f)) next.delete(f);
      else next.add(f);
      return next;
    });
  };
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

  const visibleSubmissions = filterSubmissions(sortedSubmissions, activeFilters, dueDate, hasValidDueDate);

  const handleDownload = (submission: ProblemSubmission) => {
    if (!submission.fileName) return;

    const url = `/api/uploads/submissions/${encodeURIComponent(submission.fileName)}`;
    const link = document.createElement('a');
    link.href = url;
    link.download = submission.originalFileName || 'Download';
    link.click();
  };

  const renderStatusCell = (submission: ProblemSubmission) => {
    const timingStatus = getTimingStatusChip(submission, hasValidDueDate, dueDate);
    const reviewStatus = getReviewStatusChip(submission);

    return (
      <div className="flex flex-col gap-1">
        {[timingStatus, reviewStatus].map((chip) => (
          <span
            key={chip.label}
            className="inline-flex items-center gap-2 text-xs font-medium"
            title={chip.title}
          >
            <span
              className={`inline-flex h-2.5 w-2.5 rounded-full ${statusToneClass[chip.tone]}`}
              aria-hidden="true"
            />
            <span>{chip.label}</span>
          </span>
        ))}
      </div>
    );
  };

  return (
    <Card className="print:border-0 print:shadow-none">
      <CardHeader>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <ProblemHeader
            title={problem.title}
            description={problem.description ?? undefined}
            type={problem.type ?? undefined}
            maxStates={problem.maxStates ?? undefined}
            isDeterministic={problem.isDeterministic ?? undefined}
            maxSubmissions={problem.maxSubmissions ?? undefined}
            autograderEnabled={problem.autograderEnabled ?? undefined}
          />

          {isPrivledgedUser && onGradeInputChange && onSaveGrade ? (
            <ProblemGradeForm
              value={gradeInput}
              currentGrade={currentGrade}
              disabled={courseIsArchived}
              isSaving={isSavingGrade}
              isLoading={isLoadingGrade}
              error={gradeError}
              onChange={onGradeInputChange}
              onSubmit={onSaveGrade}
              autograderStatus={submissions[0]?.status ?? null}
              onRerun={onRerunSubmission ? () => onRerunSubmission(submissions[0]) : undefined}
            />
          ) : !isPrivledgedUser ? (
            <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-transparent px-3 py-2 text-[0.70rem] text-slate-700 dark:border-slate-200 dark:text-slate-200 whitespace-nowrap">
              <span className="font-semibold uppercase tracking-[0.16em]">Grade</span>
              <span>{currentGrade !== null ? currentGrade : '-'} / {problem.maxPoints}</span>
            </div>
          ) : null}
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid items-stretch gap-4 lg:grid-cols-[60%_40%]">
          <WorkspacePanel title="Submissions" icon={<FileText className="h-4 w-4" />} className="h-full" contentClassName="p-2">
            {submissionsLoading ? (
              <div className="flex min-h-[320px] flex-col items-center justify-center gap-3">
                <div className="border-muted-foreground/30 border-t-primary h-8 w-8 animate-spin rounded-full border-4" />
                <p className="text-muted-foreground text-sm">Loading submissions...</p>
              </div>
            ) : sortedSubmissions.length > 0 ? (
              <div className="space-y-2">
                <div className="flex flex-col gap-3 px-1 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex flex-wrap gap-1">
                    <button
                      onClick={() => setActiveFilters(new Set())}
                      className={`rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition-colors ${
                        activeFilters.size === 0
                          ? 'border-foreground bg-foreground text-background'
                          : 'border-border text-muted-foreground hover:border-foreground/50 hover:text-foreground'
                      }`}
                    >
                      All
                    </button>
                    {STATUS_FILTER_OPTIONS.map(({ value, label, dot }) => {
                      const active = activeFilters.has(value);
                      return (
                        <button
                          key={value}
                          onClick={() => toggleFilter(value)}
                          className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition-colors ${
                            active
                              ? 'border-foreground bg-foreground text-background'
                              : 'border-border text-muted-foreground hover:border-foreground/50 hover:text-foreground'
                          }`}
                        >
                          <span className={`inline-flex h-2 w-2 rounded-full ${dot}`} aria-hidden="true" />
                          {label}
                        </button>
                      );
                    })}
                  </div>

                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => onRerunVisibleSubmissions?.(visibleSubmissions)}
                      disabled={visibleSubmissions.length === 0 || isRunning}
                      hidden={!isPrivledgedUser}
                      className="whitespace-nowrap"
                      title="Rerun Visible Submissions"
                    >
                      Rerun
                    </Button>
                  </div>
                </div>

                <div className="overflow-x-auto rounded-md border">
                <Table className="text-sm">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="px-2 py-1">Submitted</TableHead>
                      <TableHead className="px-2 py-1">Status</TableHead>
                      <TableHead className="px-2 py-1">Manage</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {visibleSubmissions.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={5} className="text-muted-foreground py-6 text-center text-sm">
                          No submissions match the selected filter.
                        </TableCell>
                      </TableRow>
                    ) : visibleSubmissions.map((submission) => {
                      const submittedAt = new Date(submission.submittedAt);
                      const isLate =
                        submission.status?.toLowerCase() === 'late' ||
                        (hasValidDueDate && submittedAt.getTime() > dueDate!.getTime());
                      return (
                        <TableRow key={submission.id} className="hover:bg-transparent">
                          <TableCell className="p-1 align-top">
                            <div className="flex flex-col gap-1">
                              <span>{submittedAt.toLocaleDateString()}</span>
                              <span className="text-muted-foreground text-[11px]">
                                {submittedAt.toLocaleTimeString()}
                              </span>
                              {isLate ? (
                                <Badge
                                  variant="secondary"
                                  className="mt-1 inline-flex items-center rounded-full bg-amber-100 px-2 py-1 text-[11px] font-semibold text-amber-900 shadow-sm"
                                >
                                  Late
                                </Badge>
                              ) : null}
                            </div>
                          </TableCell>
                          <TableCell className="p-1 align-top">{renderStatusCell(submission)}</TableCell>
                          <TableCell className="p-1 align-top">
                              <div className="flex items-center gap-2 whitespace-nowrap">
                                <Button
                                  variant="secondary"
                                  size="sm"
                                  onClick={() => {
                                    setActiveFeedback(String(submission.feedback));
                                    setFeedbackDialogOpen(true);
                                  }}
                                  title="View feedback"
                                  aria-label="View submission feedback"
                                  className="h-8 w-8 p-0"
                                  disabled={!submission.feedback || submission.status?.toLowerCase() === "pending" || submission.status?.toLowerCase() === "processing"}
                                >
                                  <File className="h-4 w-4" />
                                </Button>

                                <Button
                                  variant="secondary"
                                  size="sm"
                                  onClick={() => onViewSubmission(submission)}
                                  title="View submission"
                                  aria-label="View submission"
                                  className="h-8 w-8 p-0"
                                >
                                  <Eye className="h-4 w-4" />
                                </Button>

                                <Button
                                  variant="secondary"
                                  size="sm"
                                  disabled={!submission.fileName}
                                  onClick={() => handleDownload(submission)}
                                  title="Download submission"
                                  aria-label="Download submission"
                                  className="h-8 w-8 p-0"
                                >
                                  <Download className="h-4 w-4" />
                                </Button>

                                <Button
                                  variant="secondary"
                                  size="sm"
                                  disabled={submission.status?.toLowerCase() === "pending" || submission.status?.toLowerCase() === "processing"}
                                  onClick={() => onRerunSubmission?.(submission)}
                                  title="Rerun submission"
                                  aria-label="Rerun submission"
                                  className="h-8 w-8 p-0"
                                  hidden={!isPrivledgedUser}
                                >
                                  <RotateCcw className="h-4 w-4" />
                                </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
                </div>
              </div>
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
              <div className="text-muted-foreground text-sm">Loading discussion...</div>
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
      </CardContent>
      <FeedbackDialog
        open={feedbackDialogOpen}
        onOpenChange={setFeedbackDialogOpen}
        feedbackText={activeFeedback}
      />
    </Card>
  );
}
