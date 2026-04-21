'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { showToast } from '@/lib/toast';
import { ArrowLeft, Clock, BookOpen, Target, FileText, Trophy, MessageSquare, Send, Eye, Download } from 'lucide-react';
import { Badge as RoleBadge } from '@/components/ui/RoleBadge';
import JffViewerDialog from '@/components/JffViewerDialog';
import { ProblemListCard } from '@/components/assignments/ProblemListCard';
import { ProblemWorkspace } from '@/components/assignments/ProblemWorkspace';
import { RegexViewerDialog } from '@/components/dialogs/RegexViewerDialog';
import { CfgViewerDialog } from '@/components/dialogs/CfgViewerDialog';
import { useEffectiveTimezone } from '@/hooks/use-effective-timezone';
import { formatDateInTimeZone, formatTimeInTimeZone, formatDateTimeInTimeZone } from '@/lib/date';
import {
  AssignmentWithDetails,
  StudentAssignmentContext,
  StudentProblemComment,
  StudentProblemSubmission,
} from '@/lib/assignment-details';

interface AssignmentProblem {
  problem: AssignmentWithDetails['problems'][number]['problem'];
}

type StudentAssignmentViewProps = {
  initialAssignment?: AssignmentWithDetails | null;
};

export default function StudentAssignmentPage({
  initialAssignment = null,
}: StudentAssignmentViewProps) {
  const params = useParams<{ id: string; aid: string }>();
  const assignmentId = params?.aid;

  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: session } = useSession();
  const { timezone } = useEffectiveTimezone();
  const userId = session?.user?.id ?? null;
  const isStudent = session?.user?.role === 'STUDENT';

  const [assignment, setAssignment] = useState<AssignmentWithDetails | null>(initialAssignment);
  const [loading, setLoading] = useState(!initialAssignment);
  const [submissionsLoading, setSubmissionsLoading] = useState(false);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [submissionCount, setSubmissionCount] = useState(0);
  const [assignmentGrade, setAssignmentGrade] = useState<number | null>(null);
  const [submissions, setSubmissions] = useState<Record<string, StudentProblemSubmission[]>>({});
  const [comments, setComments] = useState<Record<string, StudentProblemComment[]>>({});
  const [newComment, setNewComment] = useState<Record<string, string>>({});
  const [submittingComment, setSubmittingComment] = useState<Record<string, boolean>>({});
  const [selectedProblemId, setSelectedProblemId] = useState<string | null>(null);
  const [openDialog, setOpenDialog] = useState<{
    open: boolean;
    submission: StudentProblemSubmission | null;
  }>({ open: false, submission: null });
  const limitText = (value: string, max = 120) =>
    value.length > max ? `${value.slice(0, max - 1)}…` : value;

  const loadStudentContext = useCallback(async () => {
    if (!assignmentId || !userId) return;

    setSubmissionsLoading(true);
    setCommentsLoading(true);

    try {
      const response = await fetch(`/api/assignments/${assignmentId}/student-context`);
      if (!response.ok) throw new Error('Failed to fetch assignment context');

      const context = (await response.json()) as StudentAssignmentContext;
      setAssignmentGrade(context.assignmentGrade);
      setSubmissionCount(context.submissionCount);
      setSubmissions(context.submissionsByProblem);
      setComments(context.commentsByProblem);
    } catch (error) {
      console.error('Error fetching assignment context:', error);
      showToast.error('Failed to load assignment context');
      setAssignmentGrade(null);
      setSubmissionCount(0);
      setSubmissions({});
      setComments({});
    } finally {
      setSubmissionsLoading(false);
      setCommentsLoading(false);
    }
  }, [assignmentId, userId]);

  const handleSubmitComment = useCallback(
    async (problemId: string) => {
      const text = newComment[problemId]?.trim();
      if (!text) return;

      setSubmittingComment((prev) => ({ ...prev, [problemId]: true }));

      try {
        const response = await fetch(`/api/problems/${problemId}/comments`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: text }),
        });

        if (!response.ok) {
          throw new Error('Failed to submit comment');
        }

        setNewComment((prev) => ({ ...prev, [problemId]: '' }));
        await loadStudentContext();
        showToast.success('Comment added successfully!');
      } catch (error) {
        console.error('Error submitting comment:', error);
        showToast.error('Failed to submit comment');
      } finally {
        setSubmittingComment((prev) => ({ ...prev, [problemId]: false }));
      }
    },
    [loadStudentContext, newComment],
  );

  const handleDeleteComment = useCallback(
    async (commentId: string) => {
      try {
        const response = await fetch(`/api/comments?commentId=${encodeURIComponent(commentId)}`, {
          method: 'DELETE',
        });
        if (!response.ok) {
          const error = await response.json().catch(() => ({}));
          throw new Error(error?.error || 'Failed to delete comment');
        }
        await loadStudentContext();
        showToast.success('Comment deleted successfully');
      } catch (error) {
        console.error('Error deleting comment:', error);
        showToast.error('Failed to delete comment');
      }
    },
    [loadStudentContext],
  );

  useEffect(() => {
    const fetchAssignment = async () => {
      if (initialAssignment) {
        setAssignment(initialAssignment);
        setLoading(false);
        return;
      }

      try {
        const res = await fetch(`/api/assignments/${assignmentId}`);
        if (!res.ok) {
          if (res.status === 404) {
            showToast.error('Assignment not found or you do not have permission to view it');
            router.push('/dashboard');
            return;
          }
          throw new Error('Failed to fetch assignment');
        }
        const data = (await res.json()) as AssignmentWithDetails;
        setAssignment(data);
      } catch (error) {
        console.error('Error fetching assignment:', error);
        showToast.error('Failed to load assignment');
      } finally {
        setLoading(false);
      }
    };

    if (assignmentId && session) {
      void fetchAssignment();
    }
  }, [assignmentId, initialAssignment, router, session]);

  useEffect(() => {
    if (assignment) {
      void loadStudentContext();
    }
  }, [assignment, loadStudentContext]);

  useEffect(() => {
    if (!assignment || assignment.problems.length === 0) {
      setSelectedProblemId(null);
      return;
    }

    const preferredProblemId = searchParams.get('problem');
    if (preferredProblemId && assignment.problems.some((ap) => ap.problem.id === preferredProblemId)) {
      setSelectedProblemId(preferredProblemId);
      return;
    }

    setSelectedProblemId((prev) => {
      if (prev && assignment.problems.some((ap) => ap.problem.id === prev)) {
        return prev;
      }
      return assignment.problems[0].problem.id;
    });
  }, [assignment, searchParams]);

  const problemListItems = useMemo(() => {
    if (!assignment) return [];
    return assignment.problems.map((assignmentProblem, index) => ({
      id: assignmentProblem.problem.id,
      title: assignmentProblem.problem.title
        ? limitText(assignmentProblem.problem.title, 25)
        : `Problem ${index + 1}`,
    }));
  }, [assignment]);

  const getProblemBadgeContent = useCallback(
    (problemId: string) => {
      const subs = submissions[problemId] ?? [];
      if (!subs.length) {
        return (
          <span
            title="No submissions"
            className="inline-flex h-3 w-3 rounded-full bg-red-500"
          />
        );
      }

      const latest = subs[0];
      const badgeClass = latest?.correct
        ? 'bg-emerald-500'
        : latest?.correct === false
          ? 'bg-amber-400'
          : 'bg-glue-400';
      const title = latest?.correct
        ? 'Correct'
        : latest?.correct === false
          ? 'Needs review'
          : 'Submitted';

      return (
        <span
          title={title}
          className={`inline-flex h-3 w-3 rounded-full ${badgeClass}`}
        />
      );
    },
    [submissions],
  );

  if (loading) {
    return <div className="p-6">Loading assignment...</div>;
  }

  if (!assignment) {
    return <div className="p-6">Assignment not found.</div>;
  }

  if (isStudent && !assignment.isPublished) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="pt-6">
            <p className="text-muted-foreground">This assignment is not yet available.</p>
            <Button
              variant="outline"
              onClick={() => router.push(`/dashboard/courses/${assignment.courseId}`)}
              className="mt-4"
            >
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to Course
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const dueDate = new Date(assignment.dueDate);
  const allowLateSubmissions = assignment.allowLateSubmissions ?? false;
  const lateCutoffDate = assignment.lateCutoff ? new Date(assignment.lateCutoff) : null;
  const isOverdue = dueDate < new Date();
  const courseIsArchived = assignment.course?.isArchived ?? false;
  const selectedProblem = selectedProblemId
    ? assignment.problems.find((ap) => ap.problem.id === selectedProblemId) || null
    : null;
  const selectedProblemIndex = selectedProblem
    ? assignment.problems.findIndex((ap) => ap.problem.id === selectedProblem.problem.id) + 1
    : null;
  const selectedProblemSubmissions = selectedProblemId ? submissions[selectedProblemId] || [] : [];
  const selectedProblemComments = selectedProblemId ? comments[selectedProblemId] || [] : [];

  const statusInfo = (() => {
    if (assignment.isPublished) {
      if (dueDate <= new Date()) return { label: 'Past Due', badgeClass: 'border-red-200 bg-red-50 text-red-700' };
      return { label: 'Published', badgeClass: 'border-green-200 bg-green-50 text-green-700' };
    }
    return { label: 'Not Published', badgeClass: 'border-yellow-200 bg-yellow-50 text-yellow-700' };
  })();

  return (
    <div className="space-y-6 p-6">
      <Card>
        <CardHeader>
          <CardTitle role="heading" aria-level={1} className="flex min-w-0 flex-wrap items-start gap-2 text-2xl break-words">
            <span className="font-semibold">Assignment:</span>
            <span className="min-w-0 line-clamp-2 break-words [overflow-wrap:anywhere]" title={assignment.title}>
              {assignment.title}
            </span>
          </CardTitle>
          <div className="text-muted-foreground flex flex-wrap items-center gap-2 text-sm">
            {assignment.course || assignment.courseName ? (
              <Link
                href={`/dashboard/courses/${assignment.course?.id || assignment.courseId}`}
                className="max-w-full break-all text-blue-700 hover:underline"
              >
                {assignment.course?.name || assignment.courseName || assignment.courseId}
                {assignment.course?.code
                  ? ` (${assignment.course.code})`
                  : assignment.courseCode
                    ? ` (${assignment.courseCode})`
                    : ''}
              </Link>
            ) : null}
          </div>
        </CardHeader>
        <CardContent>
          {assignment.description && (
            <div>
              <h3 className="mb-2 font-semibold">Description</h3>
              <p className="text-muted-foreground max-h-auto overflow-y-auto resize-y rounded-md border p-3 break-words whitespace-pre-wrap">
                {assignment.description}
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {assignment.problems.length > 0 ? (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg font-semibold">{assignment.title}</CardTitle>
            <div className="text-muted-foreground flex flex-wrap items-start gap-1 text-sm">
              <div className="flex flex-wrap items-start gap-y-1 gap-x-6">
                <span>
                  <span className="font-semibold">Due:</span>{' '}
                  {formatDateTimeInTimeZone(assignment.dueDate, timezone)}
                </span>
                <span>
                  <span className="font-semibold">Max Points:</span>{' '}
                  {assignment.maxPoints}
                </span>
                <span>
                  <span className="font-semibold">Problems:</span>{' '}
                  {assignment.problems.length}
                </span>
                <span className="w-full" />
                <span>
                  <span className="font-semibold">Allow Late:</span>{' '}
                  {allowLateSubmissions ? 'Yes' : 'No'}
                </span>
                <span>
                  <span className="font-semibold">Late Cutoff:</span>{' '}
                  {allowLateSubmissions
                    ? lateCutoffDate
                      ? formatDateTimeInTimeZone(lateCutoffDate, timezone)
                      : 'Never'
                    : 'N/A'}
                </span>
              </div>
              <span className="ml-auto self-start text-right text-xl">
                <span className="font-semibold">Grade:</span>{' '}
                {(assignmentGrade !== null ? `${assignmentGrade}` : `-`) + `/${assignment.maxPoints}`}
              </span>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-[minmax(240px,280px)_1fr] gap-4">
              <ProblemListCard
                problems={problemListItems}
                selectedProblemId={selectedProblemId}
                onSelect={(problemId) => setSelectedProblemId(problemId)}
                getBadgeContent={getProblemBadgeContent}
                className="h-full"
                scrollAreaClassName="max-h-[520px]"
                description="Select a problem to review submissions and discussion."
              />

              <ProblemWorkspace
                problem={selectedProblem ? selectedProblem.problem : null}
                submissions={selectedProblemSubmissions}
                assignmentDueDate={assignment.dueDate}
                comments={selectedProblemComments}
                commentText={selectedProblem ? newComment[selectedProblem.problem.id] || '' : ''}
                onCommentTextChange={(text) =>
                  selectedProblem &&
                  setNewComment((prev) => ({
                    ...prev,
                    [selectedProblem.problem.id]: text,
                  }))
                }
                onSaveComment={() =>
                  selectedProblem && handleSubmitComment(selectedProblem.problem.id)
                }
                onDeleteComment={(commentId) => handleDeleteComment(commentId)}
                isSaving={selectedProblem ? submittingComment[selectedProblem.problem.id] : false}
                deletingComments={{}}
                onViewSubmission={(submission) => setOpenDialog({ open: true, submission })}
                rerunning={{}}
                courseIsArchived={courseIsArchived}
                gradeInput=""
                currentGrade={null}
                gradeError={null}
                isPrivledgedUser={false}
                submissionsLoading={submissionsLoading}
                commentsLoading={commentsLoading}
              />
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="pt-6">
            <p className="text-muted-foreground text-center">
              No problems have been added to this assignment yet.
            </p>
          </CardContent>
        </Card>
      )}
      {/* JffViewerDialog for viewing submitted files */}
      {openDialog.submission &&
        ['FA', 'PDA', 'TM'].includes(
          assignment.problems.find((u) => u.problem.id === openDialog?.submission?.problemId)
            ?.problem?.type ?? '',
        ) && (
          <JffViewerDialog
            open={openDialog.open}
            onOpenChange={(open) => setOpenDialog({ open, submission: null })}
            src={`/api/uploads/submissions/${encodeURIComponent(openDialog.submission.fileName ?? '')}`}
            title={`${openDialog.submission.originalFileName || openDialog.submission.fileName} - Submission`}
            width="70vw"
            height="70vh"
          />
        )}
      {openDialog.submission &&
        assignment.problems.find((u) => u.problem.id === openDialog?.submission?.problemId)?.problem
          ?.type === 'RE' && (
          <RegexViewerDialog
            open={openDialog.open}
            onOpenChange={(open) => setOpenDialog({ open, submission: null })}
            src={`/api/uploads/submissions/${encodeURIComponent(openDialog.submission.fileName ?? '')}`}
            title={`${openDialog.submission.originalFileName || openDialog?.submission?.fileName} - Submission`}
          />
        )}
      {openDialog.submission &&
        assignment.problems.find((u) => u.problem.id === openDialog?.submission?.problemId)?.problem
          ?.type === 'CFG' && (
          <CfgViewerDialog
            open={openDialog.open}
            onOpenChange={(open) => setOpenDialog({ open, submission: null })}
            src={`/api/uploads/submissions/${encodeURIComponent(openDialog.submission.fileName ?? '')}`}
            title={`${openDialog.submission.originalFileName || openDialog.submission.fileName} - Submission`}
          />
        )}
    </div>
  );
}
