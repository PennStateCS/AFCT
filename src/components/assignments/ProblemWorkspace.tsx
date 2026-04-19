'use client';

import { FileText, MessageSquare, Check, X, Minus } from 'lucide-react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
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
        <span className={`rounded-full px-2 py-1 text-xs font-medium ${statusClass}`}>
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
          <WorkspacePanel title="Submissions" icon={<FileText className="h-4 w-4" />}>
            {submissionsLoading ? (
              <div className="flex min-h-[320px] flex-col items-center justify-center gap-3">
                <div className="border-muted-foreground/30 border-t-primary h-8 w-8 animate-spin rounded-full border-4" />
                <p className="text-muted-foreground text-sm">Loading submissions...</p>
              </div>
            ) : sortedSubmissions.length > 0 ? (
              <div className="overflow-x-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Submitted</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Grade</TableHead>
                      <TableHead>Feedback</TableHead>
                      <TableHead>Download</TableHead>
                      <TableHead>Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sortedSubmissions.map((submission) => {
                      const submittedAt = new Date(submission.submittedAt);
                      const isLate = hasValidDueDate && submittedAt.getTime() > dueDate!.getTime();
                      return (
                        <TableRow key={submission.id} className="hover:bg-transparent">
                          <TableCell>
                            <div className="flex flex-col">
                              <span>{submittedAt.toLocaleDateString()}</span>
                              <span className="text-muted-foreground text-xs">
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
                          <TableCell>{renderStatusCell(submission)}</TableCell>
                          <TableCell>
                            {typeof submission.grade === 'number' ? (
                              <span className="font-medium">{submission.grade}</span>
                            ) : (
                              <span className="text-muted-foreground">Not graded</span>
                            )}
                          </TableCell>
                          <TableCell className="break-words whitespace-normal">
                            {submission.feedback ? (
                              <span className="text-sm">{submission.feedback}</span>
                            ) : (
                              <span className="text-muted-foreground text-sm">No feedback</span>
                            )}
                          </TableCell>
                          <TableCell>
                            {submission.fileName ? (
                              <a
                                href={`/api/uploads/submissions/${encodeURIComponent(
                                  submission.fileName,
                                )}`}
                                download={submission.originalFileName || 'Download'}
                                className="inline-flex items-center gap-1 text-blue-600 underline hover:text-blue-800"
                                target="_blank"
                                rel="noopener noreferrer"
                                title="Download file"
                              >
                                <span>{submission.originalFileName || 'Download'}</span>
                              </a>
                            ) : (
                              <span className="text-muted-foreground text-sm">No file</span>
                            )}
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-col gap-2 whitespace-nowrap">
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
                                  className="text-sm text-slate-500 hover:text-slate-700"
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
              <div className="text-muted-foreground rounded-md border border-dashed p-6 text-center text-sm">
                No submissions yet.
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
    </Card>
  );
}
