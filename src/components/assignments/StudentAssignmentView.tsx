'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
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
        ? `Problem ${index + 1}: ${limitText(assignmentProblem.problem.title, 80)}`
        : `Problem ${index + 1}`,
    }));
  }, [assignment]);

  const getProblemBadgeContent = useCallback(
    (problemId: string) => {
      const subs = submissions[problemId] ?? [];
      if (!subs.length) {
        return (
          <Badge className="border-transparent bg-slate-100 text-[10px] font-medium text-slate-700">
            No submissions
          </Badge>
        );
      }

      const latest = subs[0];
      const label = latest?.correct
        ? 'Correct'
        : latest?.correct === false
          ? 'Needs review'
          : 'Submitted';
      const badgeClass = latest?.correct
        ? 'bg-emerald-100 text-emerald-800'
        : latest?.correct === false
          ? 'bg-amber-100 text-amber-800'
          : 'bg-blue-100 text-blue-800';

      return (
        <Badge className={`border-transparent text-[10px] font-semibold ${badgeClass}`}>
          {label}
        </Badge>
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

  return (
    <div className="space-y-6 p-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-2xl">
          <BookOpen className="h-6 w-6" />
          {assignment.title}
        </CardTitle>
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

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3 lg:grid-cols-5">
        <Card
          className={`${isOverdue ? 'border-r-4 border-l-4 border-r-red-600 border-l-red-600' : 'border-r-4 border-l-4 border-r-blue-600 border-l-blue-600'}`}
        >
          <CardContent className="pt-1 pb-1">
            <div className="flex items-center gap-3">
              <div
                className={`rounded-full p-3 ${isOverdue ? 'bg-red-100 text-red-600' : 'bg-blue-100 text-blue-600'}`}
              >
                <Clock className="h-8 w-8" />
              </div>
              <div className="flex-1">
                <p className="text-muted-foreground mb-1 text-sm font-medium">Due Date</p>
                <p
                  className={`text-lg font-bold ${isOverdue ? 'text-red-600' : 'text-foreground'}`}
                >
                  {formatDateInTimeZone(dueDate, timezone)}
                </p>
                <p className="text-muted-foreground text-sm">
                  {formatTimeInTimeZone(dueDate, timezone)}
                </p>
                {isOverdue && <p className="mt-1 text-xs font-medium text-red-600">Overdue</p>}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-r-4 border-l-4 border-r-green-600 border-l-green-600">
          <CardContent className="pt-1 pb-1">
            <div className="flex items-center gap-3">
              <div className="rounded-full bg-green-100 p-3 text-green-600">
                <Target className="h-8 w-8" />
              </div>
              <div className="flex-1">
                <p className="text-muted-foreground mb-1 text-sm font-medium">Max Points</p>
                <p className="text-foreground text-2xl font-bold">{assignment.maxPoints}</p>
                <p className="text-muted-foreground text-sm">Total possible</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-r-4 border-l-4 border-r-purple-600 border-l-purple-600">
          <CardContent className="pt-1 pb-1">
            <div className="flex items-center gap-3">
              <div className="rounded-full bg-purple-100 p-3 text-purple-600">
                <BookOpen className="h-8 w-8" />
              </div>
              <div className="flex-1">
                <p className="text-muted-foreground mb-1 text-sm font-medium">Problems</p>
                <p className="text-foreground text-2xl font-bold">{assignment.problems.length}</p>
                <p className="text-muted-foreground text-sm">
                  {assignment.problems.length === 1 ? 'Problem' : 'Problems'} to solve
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-r-4 border-l-4 border-r-orange-600 border-l-orange-600">
          <CardContent className="pt-1 pb-1">
            <div className="flex items-center gap-3">
              <div className="rounded-full bg-orange-100 p-3 text-orange-600">
                <FileText className="h-8 w-8" />
              </div>
              <div className="flex-1">
                <p className="text-muted-foreground mb-1 text-sm font-medium">Submissions</p>
                <p className="text-foreground text-2xl font-bold">{submissionCount}</p>
                <p className="text-muted-foreground text-sm">
                  {submissionCount === 1 ? 'Submission' : 'Submissions'} made
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-r-4 border-l-4 border-r-yellow-600 border-l-yellow-600">
          <CardContent className="pt-1 pb-1">
            <div className="flex items-center gap-3">
              <div className="rounded-full bg-yellow-100 p-3 text-yellow-600">
                <Trophy className="h-8 w-8" />
              </div>
              <div className="flex-1">
                <p className="text-muted-foreground mb-1 text-sm font-medium">Your Grade</p>
                {assignmentGrade !== null ? (
                  <>
                    <p className="text-foreground text-2xl font-bold">
                      {Math.round((assignmentGrade / assignment.maxPoints) * 100)}%
                    </p>
                    <p className="text-muted-foreground text-sm">{assignmentGrade} points earned</p>
                  </>
                ) : (
                  <>
                    <p className="text-muted-foreground text-2xl font-bold">--</p>
                    <p className="text-muted-foreground text-sm">Not graded yet</p>
                  </>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {assignment.problems.length > 0 ? (
        <Card>
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
