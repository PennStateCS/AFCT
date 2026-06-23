'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { showToast } from '@/lib/toast';
import { ArrowLeft } from 'lucide-react';
import JffViewerDialog from '@/components/JffViewerDialog';
import { ProblemListCard } from '@/components/assignments/ProblemListCard';
import ProblemWorkspace from '@/components/assignments/ProblemWorkspace';
import { RegexViewerDialog } from '@/components/dialogs/RegexViewerDialog';
import { CfgViewerDialog } from '@/components/dialogs/CfgViewerDialog';
import { useEffectiveTimezone } from '@/hooks/use-effective-timezone';
import { formatDateTimeInTimeZone } from '@/lib/date';
import {
  AssignmentWithDetails,
  StudentAssignmentContext,
  StudentProblemComment,
  StudentProblemSubmission,
} from '@/lib/assignment-details';

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
  const [submissions, setSubmissions] = useState<Record<string, StudentProblemSubmission[]>>({});
  const [comments, setComments] = useState<Record<string, StudentProblemComment[]>>({});
  const [newComment, setNewComment] = useState<Record<string, string>>({});
  const [submittingComment, setSubmittingComment] = useState<Record<string, boolean>>({});
  const [problemGrades, setProblemGrades] = useState<Record<string, number | null>>({});
  const [assignmentGrade, setAssignmentGrade] = useState<number | null>(null);
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
      setProblemGrades(context.problemGrades);
      setSubmissionCount(context.submissionCount);
      setSubmissions(context.submissionsByProblem);
      setComments(context.commentsByProblem);
    } catch (error) {
      console.error('Error fetching assignment context:', error);
      showToast.error('Failed to load assignment context');
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
      grade: problemGrades[assignmentProblem.problem.id] ?? null,
      maxGrade: assignmentProblem.maxPoints ?? null,
      submissionsCount: submissions[assignmentProblem.problem.id]?.length ?? 0,
      maxSubmissions: assignmentProblem.maxSubmissions ?? null,
    }));
  }, [assignment, submissions, problemGrades]);

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

  const allowLateSubmissions = assignment.allowLateSubmissions ?? false;
  const lateCutoffDate = assignment.lateCutoff ? new Date(assignment.lateCutoff) : null;
  const dueDisplay = formatDateTimeInTimeZone(assignment.dueDate, timezone);
  const lateCutoffDisplay = allowLateSubmissions
    ? lateCutoffDate
      ? formatDateTimeInTimeZone(lateCutoffDate, timezone)
      : 'Never'
    : 'Not allowed';
  const latePolicyDisplay = !allowLateSubmissions
    ? 'Not accepted'
    : lateCutoffDate
      ? `Accepted until ${lateCutoffDisplay}`
      : 'Accepted anytime';
  const gradeDisplay = assignmentGrade !== null ? `${assignmentGrade}` : '-';
  const courseIsArchived = assignment.course?.isArchived ?? false;
  const selectedProblem = selectedProblemId
    ? assignment.problems.find((ap) => ap.problem.id === selectedProblemId) || null
    : null;
  const selectedProblemSubmissions = selectedProblemId ? submissions[selectedProblemId] || [] : [];
  const selectedProblemComments = selectedProblemId ? comments[selectedProblemId] || [] : [];
  const selectedProblemGrade = selectedProblem
    ? problemGrades[selectedProblem.problem.id] ?? selectedProblemSubmissions[0]?.grade ?? null
    : null;
  const selectedProblemDetails = selectedProblem
    ? {
        ...selectedProblem.problem,
        maxPoints: selectedProblem.maxPoints ?? selectedProblem.problem.maxPoints,
        maxSubmissions: selectedProblem.maxSubmissions ?? selectedProblem.problem.maxSubmissions,
        autograderEnabled: selectedProblem.autograderEnabled ?? selectedProblem.problem.autograderEnabled,
      }
    : null;

  console.log()
  return (
    <div className="space-y-6 p-6">
      <Card>
        <CardHeader>
          <CardTitle role="heading" aria-level={1} className="flex min-w-0 flex-wrap items-start gap-2 text-2xl break-words">
            <span className="font-semibold">Assignment:</span>
            <span className="min-w-0 break-words [overflow-wrap:anywhere]">
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
            <div className="flex flex-col gap-3 lg:flex-row lg:items-stretch lg:justify-between">
              <div className="flex flex-1 flex-wrap gap-2">
                <div className="inline-flex min-h-10 items-center rounded-full border border-slate-200 bg-transparent px-3 py-2 text-sm leading-none text-slate-700 dark:border-slate-200 dark:text-slate-200">
                  <span className="mr-2 shrink-0 text-[11px] font-semibold uppercase tracking-[0.16em]">
                    Due
                  </span>
                  <span className="font-semibold leading-none">{dueDisplay}</span>
                </div>
                <div className="inline-flex min-h-10 items-center rounded-full border border-slate-200 bg-transparent px-3 py-2 text-sm leading-none text-slate-700 dark:border-slate-200 dark:text-slate-200">
                  <span className="mr-2 shrink-0 text-[11px] font-semibold uppercase tracking-[0.16em]">
                    Points
                  </span>
                  <span className="font-semibold leading-none">{assignment.maxPoints}</span>
                </div>
                <div className="inline-flex min-h-10 items-center rounded-full border border-slate-200 bg-transparent px-3 py-2 text-sm leading-none text-slate-700 dark:border-slate-200 dark:text-slate-200">
                  <span className="mr-2 shrink-0 text-[11px] font-semibold uppercase tracking-[0.16em]">
                    Problems
                  </span>
                  <span className="font-semibold leading-none">{assignment.problems.length}</span>
                </div>
                <div className="inline-flex min-h-10 items-center rounded-full border border-slate-200 bg-transparent px-3 py-2 text-sm leading-none text-slate-700 dark:border-slate-200 dark:text-slate-200">
                  <span className="mr-2 shrink-0 text-[11px] font-semibold uppercase tracking-[0.16em]">
                    Late Policy
                  </span>
                  <span className="font-semibold leading-none">{latePolicyDisplay}</span>
                </div>
              </div>
              <div className="inline-flex min-h-10 items-center rounded-full border border-slate-200 bg-transparent px-4 py-2 text-right lg:self-start text-slate-700 dark:border-slate-200 dark:text-slate-200">
                <span className="mr-2 shrink-0 text-[11px] font-semibold uppercase tracking-[0.16em]">
                  Grade
                </span>
                <span className="ml-1 text-sm font-medium leading-none">{gradeDisplay}</span>
                <span className="ml-1 text-sm font-medium leading-none">/ {assignment.maxPoints}</span>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(240px,280px)_1fr]">
              <ProblemListCard
                problems={problemListItems}
                selectedProblemId={selectedProblemId}
                onSelect={(problemId) => setSelectedProblemId(problemId)}
                className="h-full"
                scrollAreaClassName="max-h-[520px]"
                description="Select a problem to review submissions and discussion."
              />

              <ProblemWorkspace
                problem={selectedProblemDetails}
                submissions={selectedProblemSubmissions}
                assignmentDueDate={assignment.dueDate}
                comments={selectedProblemComments}
                commentText={selectedProblem ? newComment[selectedProblem.problem.id] || '' : ''}
                onCommentTextChange={(text: string) =>
                  selectedProblem &&
                  setNewComment((prev) => ({
                    ...prev,
                    [selectedProblem.problem.id]: text,
                  }))
                }
                onSaveComment={() =>
                  selectedProblem && handleSubmitComment(selectedProblem.problem.id)
                }
                onDeleteComment={(commentId: string) => handleDeleteComment(commentId)}
                isSaving={selectedProblem ? submittingComment[selectedProblem.problem.id] : false}
                deletingComments={{}}
                onViewSubmission={(submission: StudentProblemSubmission) =>
                  setOpenDialog({ open: true, submission })
                }
                courseIsArchived={courseIsArchived}
                currentGrade={selectedProblemGrade}
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
            title={`${openDialog.submission.originalFileName || openDialog?.submission?.fileName} - Submission`}
          />
        )}
    </div>
  );
}
