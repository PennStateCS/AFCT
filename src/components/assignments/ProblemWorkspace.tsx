'use client';

import { useState } from 'react';
import { FileText, MessageSquare, Check, X, Minus } from 'lucide-react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Eye, Download, File } from 'lucide-react';
import ProblemHeader from '@/components/ProblemHeader';
import ProblemGradeForm from '@/components/ProblemGradeForm';
import WorkspacePanel from '@/components/WorkspacePanel';
import ProblemDiscussionPanel from '@/components/ProblemDiscussionPanel';
import type { Comment as DiscussionComment } from '@/components/DiscussionPanel';
import type { StudentProblemComment } from '@/lib/assignment-details';

type StatusTone = 'green' | 'amber' | 'red' | 'gray' | 'blue' | 'violet' | 'yellow' | 'pink';

type StatusChip = {
  label: string;
  tone: StatusTone;
  title: string;
};

const statusToneClass: Record<StatusTone, string> = {
  green: 'bg-emerald-500',
  amber: 'bg-amber-500',
  red: 'bg-rose-500',
  gray: 'bg-slate-400',
  blue: 'bg-sky-500',
  violet: 'bg-violet-500',
  yellow: 'bg-yellow-300',
  pink: 'bg-pink-500',
};

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

type ProblemSubmission = {
  id: string;
  submittedAt: string | Date;
  fileName?: string | null;
  originalFileName?: string | null;
  feedback?: string | null;
  grade?: number | null;
  status: string;
  correct?: boolean | null;
  problemId?: string | null;
  [key: string]: unknown;
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

const getTimingStatusChip = (
  submission: ProblemSubmission,
  hasValidDueDate: boolean,
  dueDate: Date | null,
): StatusChip => {
  const submittedAt = new Date(submission.submittedAt);
  const isLate =
    submission.status === 'LATE' ||
    (hasValidDueDate && !!dueDate && submittedAt.getTime() > dueDate.getTime());

  if (isLate) {
    return {
      label: 'Late',
      tone: 'amber',
      title: 'Submitted after due date',
    };
  }

  return {
    label: 'On time',
    tone: 'green',
    title: 'Submitted before due date',
  };
};

const getReviewStatusChip = (submission: ProblemSubmission, autograderEnabled: boolean | undefined): StatusChip => {
  const hasGrade = submission.grade !== null && submission.grade !== undefined;
  if (hasGrade) {
    return {
      label: 'Graded',
      tone: 'blue',
      title: 'Submission has been graded',
    };
  }

  if (autograderEnabled) {
    const subm_status = submission.status.toLocaleLowerCase();
    if (subm_status == 'processing') {
      return {
        label: 'Processing',
        tone: 'yellow',
        title: 'Submission being graded',
      };
    }

    if (subm_status == 'failed') {
      return {
        label: 'Failed',
        tone: 'pink',
        title: 'Submission analysis failed',
      };
    }

    return {
      label: 'Pending',
      tone: 'violet',
      title: 'Submission is waiting to be graded',
    };
  } else {
    return {
      label: 'Pending Grade',
      tone: 'violet',
      title: 'Submission is waiting to be graded',
    };
  }
};

const getNoSubmissionChip = (hasValidDueDate: boolean, dueDate: Date | null): StatusChip => {
  const now = Date.now();
  const pastDue = hasValidDueDate && !!dueDate && now > dueDate.getTime();

  if (pastDue) {
    return {
      label: 'Missing submission',
      tone: 'red',
      title: 'No submission found and due date has passed',
    };
  }

  return {
    label: 'Not submitted',
    tone: 'gray',
    title: 'No submission yet and due date has not passed',
  };
};

export function ProblemWorkspace({
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
  rerunning = {},
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
  const [activeFeedback, setActiveFeedback] = useState<string | null>(null);
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

    const url = `/api/uploads/submissions/${encodeURIComponent(submission.fileName)}`;
    const link = document.createElement('a');
    link.href = url;
    link.download = submission.originalFileName || 'Download';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const renderStatusCell = (submission: ProblemSubmission, autoGraderEnabled: boolean | undefined) => {
    const timingStatus = getTimingStatusChip(submission, hasValidDueDate, dueDate);
    const reviewStatus = getReviewStatusChip(submission, autoGraderEnabled);

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
            />
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
                <div className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-[11px] font-medium">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" aria-hidden="true" />
                    On time
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="inline-flex h-2.5 w-2.5 rounded-full bg-amber-500" aria-hidden="true" />
                    Late
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="inline-flex h-2.5 w-2.5 rounded-full bg-sky-500" aria-hidden="true" />
                    Graded
                  </span>
                  { problem.autograderEnabled ? (
                    <div className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-[11px] font-medium">
                      <span className="inline-flex items-center gap-1.5">
                        <span className="inline-flex h-2.5 w-2.5 rounded-full bg-violet-500" aria-hidden="true" />
                        Pending
                      </span>
                      <span className="inline-flex items-center gap-1.5">
                        <span className="inline-flex h-2.5 w-2.5 rounded-full bg-yellow-300" aria-hidden="true" />
                        Processing
                      </span>
                      <span className="inline-flex items-center gap-1.5">
                        <span className="inline-flex h-2.5 w-2.5 rounded-full bg-pink-500" aria-hidden="true" />
                        Failed
                      </span>
                    </div>
                  ) : (
                    <div className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-[11px] font-medium">
                      <span className="inline-flex items-center gap-1.5">
                        <span className="inline-flex h-2.5 w-2.5 rounded-full bg-violet-500" aria-hidden="true" />
                        Pending Grade
                      </span>
                    </div>
                  )}
                </div>
                <div className="overflow-x-auto rounded-md border">
                <Table className="text-sm">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="px-2 py-1">Submitted</TableHead>
                      <TableHead className="px-2 py-1">Status</TableHead>
                      <TableHead className="px-2 py-1">Grade</TableHead>
                      <TableHead className="px-2 py-1">Feedback</TableHead>
                      <TableHead className="px-2 py-1">View</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sortedSubmissions.map((submission) => {
                      const submittedAt = new Date(submission.submittedAt);
                      const isLate =
                        submission.status === 'LATE' ||
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
                          <TableCell className="p-1 align-top">{renderStatusCell(submission, problem.autograderEnabled ?? undefined)}</TableCell>
                          <TableCell className="p-1 align-top">
                            <span className="font-medium">
                              {(submission.grade ? submission.grade : '-') + '/' + problem.maxPoints}
                            </span>
                          </TableCell>
                          <TableCell className="p-1 align-top text-sm">
                            {submission.feedback ? (
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
                              >
                                <File className="h-4 w-4" />
                              </Button>
                            ) : (
                              <span className="text-muted-foreground text-sm">No feedback</span>
                            )}
                          </TableCell>
                          <TableCell className="p-1 align-top">
                            <div className="flex items-center gap-2 whitespace-nowrap">
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
                <div className="inline-flex items-center gap-2">
                  {(() => {
                    const noSubmissionStatus = getNoSubmissionChip(hasValidDueDate, dueDate);
                    return (
                      <>
                        <span
                          className={`inline-flex h-2.5 w-2.5 rounded-full ${statusToneClass[noSubmissionStatus.tone]}`}
                          aria-hidden="true"
                        />
                        <span className="font-medium" title={noSubmissionStatus.title}>
                          {noSubmissionStatus.label}
                        </span>
                      </>
                    );
                  })()}
                </div>
                <p>No submissions yet.</p>
              </div>
            )}
          </WorkspacePanel>

          <Dialog open={feedbackDialogOpen} onOpenChange={setFeedbackDialogOpen}>
            <DialogContent className="bg-card max-w-xl p-0">
              <DialogHeader className="px-6 pt-6">
                <DialogTitle>Feedback</DialogTitle>
                <DialogDescription className="text-sm text-muted-foreground">
                  Review the submission feedback below.
                </DialogDescription>
              </DialogHeader>
              <div className="max-h-[60vh] overflow-auto px-6 py-5 text-base leading-relaxed text-slate-900">
                {activeFeedback ? activeFeedback : 'No feedback available.'}
              </div>
              <DialogFooter className="px-6 pb-6 pt-2">
                <DialogClose asChild>
                  <Button variant="secondary" type="button" className="h-10 rounded-md px-4 py-2 text-sm font-medium">
                    Close
                  </Button>
                </DialogClose>
              </DialogFooter>
            </DialogContent>
          </Dialog>

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
    </Card>
  );
}
