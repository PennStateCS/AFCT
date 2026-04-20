'use client';

import { useState } from 'react';
import { FileText, MessageSquare, Check, X, Minus } from 'lucide-react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
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
import ProblemHeader from '@/components/ProblemHeader';
import ProblemGradeForm from '@/components/ProblemGradeForm';
import WorkspacePanel from '@/components/WorkspacePanel';
import ProblemDiscussionPanel from '@/components/ProblemDiscussionPanel';
import type { Comment as DiscussionComment } from '@/components/DiscussionPanel';
import type { StudentProblemComment } from '@/lib/assignment-details';

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
  status?: string;
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

  const renderStatusCell = (submission: ProblemSubmission) => {
    if (submission.status) {
      const status = submission.status;
      const statusClass =
        status === 'GRADED'
          ? 'bg-green-100 text-green-800'
          : status === 'LATE'
          ? 'bg-red-100 text-red-800'
          : 'bg-yellow-100 text-yellow-800';
      return (
        <span className={`rounded-full px-2 py-1 text-sm font-medium ${statusClass}`}>
          {status}
        </span>
      );
    }

    if (submission.correct === true) {
      return (
        <div className="flex justify-center">
          <Check className="h-4 w-4 text-green-600" />
        </div>
      );
    }

    if (submission.correct === false) {
      return (
        <div className="flex justify-center">
          <X className="h-4 w-4 text-red-600" />
        </div>
      );
    }

    return (
      <div className="text-muted-foreground flex items-center gap-2">
        <Minus className="h-4 w-4" />
        <span className="text-sm">Submitted</span>
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
              <div className="overflow-x-auto rounded-md border">
                <Table className="text-sm">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="px-2 py-1">Submitted</TableHead>
                      <TableHead className="px-2 py-1">Status</TableHead>
                      <TableHead className="px-2 py-1">Grade</TableHead>
                      <TableHead className="px-2 py-1">Feedback</TableHead>
                      <TableHead className="px-2 py-1">Download</TableHead>
                      <TableHead className="px-2 py-1">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sortedSubmissions.map((submission) => {
                      const submittedAt = new Date(submission.submittedAt);
                      const isLate = hasValidDueDate && submittedAt.getTime() > dueDate!.getTime();
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
                                  className="mt-1 w-fit bg-amber-100 text-amber-800 shadow-sm"
                                >
                                  Late
                                </Badge>
                              ) : null}
                            </div>
                          </TableCell>
                          <TableCell className="p-1 align-top">{renderStatusCell(submission)}</TableCell>
                          <TableCell className="p-1 align-top">
                            {typeof submission.grade === 'number' ? (
                              <span className="font-medium">{submission.grade}</span>
                            ) : (
                              <span className="text-muted-foreground">Not graded</span>
                            )}
                          </TableCell>
                          <TableCell className="p-1 align-top text-sm">
                            {submission.feedback ? (
                              <button
                                type="button"
                                onClick={() => {
                                  setActiveFeedback(String(submission.feedback));
                                  setFeedbackDialogOpen(true);
                                }}
                                className="rounded-md bg-slate-100 px-2 py-1 text-sm font-medium text-slate-900 transition hover:bg-slate-200"
                              >
                                View feedback
                              </button>
                            ) : (
                              <span className="text-muted-foreground text-sm">No feedback</span>
                            )}
                          </TableCell>
                          <TableCell className="p-1 align-top">
                            {submission.fileName ? (
                              <button
                                type="button"
                                onClick={() => handleDownload(submission)}
                                className="rounded-md bg-slate-100 px-2 py-1 text-sm font-medium text-slate-900 transition hover:bg-slate-200"
                                title="Download file"
                              >
                                {submission.originalFileName || 'Download'}
                              </button>
                            ) : (
                              <span className="text-muted-foreground text-sm">No file</span>
                            )}
                          </TableCell>
                          <TableCell className="p-1 align-top">
                            <div className="flex flex-col gap-1 whitespace-nowrap text-sm">
                              <button
                                type="button"
                                onClick={() => onViewSubmission(submission)}
                                className="text-blue-600 hover:underline"
                              >
                                View
                              </button>
                              {isPrivledgedUser && onRerunSubmission && submission.fileName ? (
                                <button
                                  type="button"
                                  disabled={Boolean(rerunning?.[submission.id])}
                                  onClick={() => onRerunSubmission(submission)}
                                  className="text-slate-500 hover:text-slate-700"
                                >
                                  {rerunning?.[submission.id] ? 'Rerunning…' : 'Rerun'}
                                </button>
                              ) : null}
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <div className="text-muted-foreground rounded-md border border-dashed p-4 text-center text-sm">
                No submissions yet.
              </div>
            )}
          </WorkspacePanel>

          <Dialog open={feedbackDialogOpen} onOpenChange={setFeedbackDialogOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Feedback</DialogTitle>
                <DialogDescription className="text-sm">
                  Review the submission feedback below.
                </DialogDescription>
              </DialogHeader>
              <div className="max-h-[60vh] overflow-auto text-base leading-relaxed text-slate-900">
                {activeFeedback ? activeFeedback : 'No feedback available.'}
              </div>
              <DialogClose className="mt-4 inline-flex rounded-md bg-slate-100 px-4 py-2 text-sm font-medium text-slate-900 hover:bg-slate-200">
                Close
              </DialogClose>
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
