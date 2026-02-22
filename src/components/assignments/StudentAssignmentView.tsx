'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { Assignment, Problem, Course } from '@prisma/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { showToast } from '@/lib/toast';
import {
  ArrowLeft,
  Clock,
  BookOpen,
  Target,
  FileText,
  Trophy,
  MessageSquare,
  Send,
  Eye,
  EyeOff,
  Download,
} from 'lucide-react';
import { Badge as RoleBadge } from '@/components/ui/RoleBadge';
import JffViewerDialog from '@/components/JffViewerDialog';
import { RegexViewerDialog } from '@/components/dialogs/RegexViewerDialog';
import { CfgViewerDialog } from '@/components/dialogs/CfgViewerDialog';
import { useEffectiveTimezone } from '@/hooks/use-effective-timezone';
import { formatDateInTimeZone, formatTimeInTimeZone, formatDateTimeInTimeZone } from '@/lib/date';

type AssignmentProblem = {
  problem: Problem;
};

type AssignmentWithDetails = Assignment & {
  course: Course;
  problems: AssignmentProblem[];
};

type Submission = {
  id: string;
  submittedAt: string;
  grade: number | null;
  feedback: string | null;
  problemId: string;
  status: 'SUBMITTED' | 'GRADED' | 'LATE';
  fileName?: string | null;
  originalFileName?: string | null;
  correct?: boolean | null;
};

type Comment = {
  id: string;
  content: string;
  createdAt: string;
  authorName: string;
  authorRole: 'STUDENT' | 'FACULTY' | 'ADMIN' | 'TA';
  problemId: string;
};

export default function StudentAssignmentPage() {
  const { id, aid } = useParams();
  const { data: session } = useSession();
  const router = useRouter();
  const [assignment, setAssignment] = useState<AssignmentWithDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [submissionCount, setSubmissionCount] = useState<number>(0);
  const [assignmentGrade, setAssignmentGrade] = useState<number | null>(null);
  const [submissions, setSubmissions] = useState<Record<string, Submission[]>>({});
  const [comments, setComments] = useState<Record<string, Comment[]>>({});
  const [newComment, setNewComment] = useState<Record<string, string>>({});
  const [submittingComment, setSubmittingComment] = useState<Record<string, boolean>>({});
  const [expandedProblems, setExpandedProblems] = useState<Record<string, boolean>>({});
  const { timezone } = useEffectiveTimezone();

  const isStudent = session?.user?.role === 'STUDENT';

  // Helper functions
  const getProblemTypeBadgeProps = (type: string | null) => {
    if (!type) return null;

    const badgeMap: Record<string, { label: string; className: string; borderColor: string }> = {
      PDA: {
        label: 'Pushdown Automaton',
        className: 'bg-purple-100 text-purple-800 border-purple-200',
        borderColor: 'border-l-purple-500',
      },
      RE: {
        label: 'Regular Expression',
        className: 'bg-blue-100 text-blue-800 border-blue-200',
        borderColor: 'border-l-blue-500',
      },
      CFG: {
        label: 'Context-Free Grammar',
        className: 'bg-green-100 text-green-800 border-green-200',
        borderColor: 'border-l-green-500',
      },
      FA: {
        label: 'Finite Automaton',
        className: 'bg-orange-100 text-orange-800 border-orange-200',
        borderColor: 'border-l-orange-500',
      },
    };

    return (
      badgeMap[type] || {
        label: type,
        className: 'bg-gray-100 text-gray-800 border-gray-200',
        borderColor: 'border-l-gray-500',
      }
    );
  };
  const loadCommentsForProblems = useCallback(async () => {
    if (!assignment) return;

    // Load real comments for each problem
    const commentsData: Record<string, Comment[]> = {};

    for (const assignmentProblem of assignment.problems) {
      const problemId = assignmentProblem.problem.id;

      // Make sure user id is not null
      if (!session?.user?.id) return [];

      try {
        const response = await fetch(
          `/api/problems/${problemId}/comments?problemId=${problemId}&studentId=${session.user.id}`,
        );
        if (response.ok) {
          const problemComments = await response.json();
          commentsData[problemId] = problemComments;
        } else {
          // If API call fails, set empty array
          commentsData[problemId] = [];
        }
      } catch (error) {
        console.error('Error fetching comments for problem:', problemId, error);
        commentsData[problemId] = [];
      }
    }

    setComments(commentsData);
  }, [assignment, setComments]);

  const fetchSubmissionsForProblem = useCallback(
    async (problemId: string) => {
      if (!session?.user?.id) return [];

      try {
        const response = await fetch(
          `/api/problems/${problemId}/submissions?userId=${session.user.id}`,
        );
        if (!response.ok) {
          throw new Error('Failed to fetch submissions');
        }
        const data = await response.json();
        return data;
      } catch (error) {
        console.error('Error fetching submissions for problem:', problemId, error);
        return [];
      }
    },
    [session],
  );

  const loadSubmissionsForAllProblems = useCallback(async () => {
    if (!assignment || !session?.user?.id) return;

    const submissionsData: Record<string, Submission[]> = {};
    let totalSubmissions = 0;

    for (const assignmentProblem of assignment.problems) {
      const problemId = assignmentProblem.problem.id;
      const problemSubmissions = await fetchSubmissionsForProblem(problemId);
      submissionsData[problemId] = problemSubmissions;
      totalSubmissions += problemSubmissions.length;
    }

    setSubmissions(submissionsData);
    setSubmissionCount(totalSubmissions);
  }, [assignment, session, fetchSubmissionsForProblem]);

  const handleSubmitComment = async (problemId: string) => {
    const commentText = newComment[problemId]?.trim();
    if (!commentText) return;

    setSubmittingComment((prev) => ({ ...prev, [problemId]: true }));

    try {
      const response = await fetch(`/api/problems/${problemId}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: commentText }),
      });

      if (!response.ok) {
        throw new Error('Failed to submit comment');
      }

      // Clear the input
      setNewComment((prev) => ({ ...prev, [problemId]: '' }));

      // Make sure user id is not null
      if (!session?.user?.id) return [];

      // Refresh comments for this problem
      try {
        const commentsResponse = await fetch(
          `/api/problems/${problemId}/comments?problemId=${problemId}&studentId=${session.user.id}`,
        );
        if (commentsResponse.ok) {
          const updatedComments = await commentsResponse.json();
          setComments((prev) => ({
            ...prev,
            [problemId]: updatedComments,
          }));
        }
      } catch (error) {
        console.error('Error refreshing comments:', error);
      }

      showToast.success('Comment added successfully!');
    } catch (error) {
      console.error('Error submitting comment:', error);
      showToast.error('Failed to submit comment');
    } finally {
      setSubmittingComment((prev) => ({ ...prev, [problemId]: false }));
    }
  };

  const toggleProblemExpansion = (problemId: string) => {
    setExpandedProblems((prev) => ({
      ...prev,
      [problemId]: !prev[problemId],
    }));
  };

  const [openDialog, setOpenDialog] = useState<{ open: boolean; submission: Submission | null }>({
    open: false,
    submission: null,
  });

  useEffect(() => {
    const fetchAssignment = async () => {
      try {
        const res = await fetch(`/api/assignments/${aid}`);
        if (!res.ok) {
          if (res.status === 404) {
            console.error('Assignment not found - Response:', await res.text());
            showToast.error('Assignment not found or you do not have permission to view it');
            router.push('/dashboard');
            return;
          }
          throw new Error('Failed to fetch assignment');
        }
        const data = await res.json();
        setAssignment(data);
      } catch (error) {
        console.error('Error fetching assignment:', error);
        showToast.error('Failed to load assignment');
      } finally {
        setLoading(false);
      }
    };

    const fetchStudentData = async () => {
      if (!isStudent || !aid) return;

      try {
        // Fetch assignment grade if available
        const gradeResponse = await fetch(
          `/api/assignments/${aid}/grade?userId=${session?.user?.id}`,
        );
        if (gradeResponse.ok) {
          const gradeData = await gradeResponse.json();
          setAssignmentGrade(gradeData.grade);
        } else {
          // If no grade endpoint exists, keep mock data for now
          setAssignmentGrade(85); // Mock: 85 points
        }
      } catch (error) {
        console.error('Error fetching student data:', error);
        // Fallback to mock data
        setAssignmentGrade(85);
      }
    };

    if (aid && session) {
      fetchAssignment();
      fetchStudentData();
    }
  }, [aid, router, session, isStudent]);

  // Load real comments and submissions when assignment is available
  useEffect(() => {
    if (assignment) {
      loadCommentsForProblems(); // Load real comments
      loadSubmissionsForAllProblems(); // Load real submissions
    }
  }, [assignment, loadCommentsForProblems, loadSubmissionsForAllProblems]);

  if (loading) {
    return <div className="p-6">Loading assignment...</div>;
  }

  if (!assignment) {
    return <div className="p-6">Assignment not found.</div>;
  }

  // Check if assignment is published for students
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

  return (
    <div className="space-y-6 p-6">
      {/* Assignment Details */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-2xl">
            <BookOpen className="h-5 w-5" />
            {assignment.title}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {assignment.description && (
            <div>
              <h3 className="mb-2 font-semibold">Description</h3>
              <p className="text-muted-foreground">{assignment.description}</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Statistics Cards */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3 lg:grid-cols-5">
        {/* Due Date Card */}
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

        {/* Max Points Card */}
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

        {/* Problems Card */}
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

        {/* Submissions Card */}
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

        {/* Grade Card */}
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

      {/* Problems */}
      {assignment.problems.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BookOpen className="h-5 w-5" />
              Problems & Submissions
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-6">
              {assignment.problems.map((assignmentProblem, index) => {
                const problemId = assignmentProblem.problem.id;
                const problemSubmissions = submissions[problemId] || [];
                const problemComments = comments[problemId] || [];
                const isExpanded = expandedProblems[problemId] || false;

                return (
                  <div
                    key={problemId}
                    className={`rounded-lg border border-l-4 p-4 ${getProblemTypeBadgeProps(assignmentProblem.problem.type)?.borderColor || 'border-l-gray-500'}`}
                  >
                    {/* Problem Header */}
                    <div className="mb-4 flex items-start justify-between">
                      <div className="flex-1">
                        <h3 className="text-lg font-semibold">
                          Problem {index + 1}: {assignmentProblem.problem.title}
                        </h3>
                        {assignmentProblem.problem.description && (
                          <p className="text-muted-foreground mt-1">
                            {assignmentProblem.problem.description}
                          </p>
                        )}
                        <div className="text-muted-foreground mt-2 flex items-center gap-4 text-sm">
                          {assignmentProblem.problem.type && (
                            <div className="flex items-center gap-2">
                              <Badge
                                variant="outline"
                                className={
                                  getProblemTypeBadgeProps(assignmentProblem.problem.type)
                                    ?.className
                                }
                              >
                                {getProblemTypeBadgeProps(assignmentProblem.problem.type)?.label}
                              </Badge>
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => toggleProblemExpansion(problemId)}
                        >
                          {isExpanded ? (
                            <>
                              <EyeOff className="mr-2 h-4 w-4" />
                              Hide Details
                            </>
                          ) : (
                            <>
                              <Eye className="mr-2 h-4 w-4" />
                              Show Details
                            </>
                          )}
                        </Button>
                      </div>
                    </div>

                    {/* Expandable Details */}
                    {isExpanded && (
                      <div className="space-y-4">
                        {/* Submissions Table */}
                        <div>
                          <h4 className="mb-2 flex items-center gap-2 font-medium">
                            <FileText className="h-4 w-4" />
                            Your Submissions ({problemSubmissions.length})
                          </h4>
                          {problemSubmissions.length > 0 ? (
                            <div className="rounded-lg border">
                              <Table>
                                <TableHeader>
                                  <TableRow>
                                    <TableHead>Submitted At</TableHead>
                                    <TableHead>Status</TableHead>
                                    <TableHead>Grade</TableHead>
                                    <TableHead>Feedback</TableHead>
                                    <TableHead>Download</TableHead>
                                    <TableHead>Submission</TableHead>
                                  </TableRow>
                                </TableHeader>
                                <TableBody>
                                  {problemSubmissions.map((submission) => (
                                    <TableRow key={submission.id}>
                                      <TableCell>
                                        {formatDateTimeInTimeZone(submission.submittedAt, timezone)}
                                      </TableCell>
                                      <TableCell>
                                        <span
                                          className={`rounded-full px-2 py-1 text-xs font-medium ${
                                            submission.status === 'GRADED'
                                              ? 'bg-green-100 text-green-800'
                                              : submission.status === 'LATE'
                                                ? 'bg-red-100 text-red-800'
                                                : 'bg-yellow-100 text-yellow-800'
                                          }`}
                                        >
                                          {submission.status}
                                        </span>
                                      </TableCell>
                                      <TableCell>
                                        {submission.grade !== null ? (
                                          <span className="font-medium">{submission.grade}</span>
                                        ) : (
                                          <span className="text-muted-foreground">Not graded</span>
                                        )}
                                      </TableCell>
                                      <TableCell>
                                        {submission.feedback ? (
                                          <span className="text-sm">{submission.feedback}</span>
                                        ) : (
                                          <span className="text-muted-foreground">No feedback</span>
                                        )}
                                      </TableCell>
                                      <TableCell>
                                        {submission.fileName ? (
                                          <a
                                            href={`/api/uploads/submissions/${encodeURIComponent(submission.fileName)}`}
                                            download={submission.originalFileName || 'Download'}
                                            className="inline-flex items-center gap-1 text-blue-600 underline hover:text-blue-800"
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            title="Download file"
                                          >
                                            <Download className="h-4 w-4" aria-hidden="true" />
                                            <span>{submission.originalFileName || 'Download'}</span>
                                          </a>
                                        ) : (
                                          <span className="text-muted-foreground text-sm">
                                            No file
                                          </span>
                                        )}
                                      </TableCell>
                                      <TableCell>
                                        <div className="flex items-center gap-2">
                                          {submission.fileName ? (
                                            <Button
                                              size="sm"
                                              variant="secondary"
                                              onClick={() =>
                                                setOpenDialog({ open: true, submission })
                                              }
                                              className="flex items-center gap-1"
                                            >
                                              <Eye className="mr-2 h-4 w-4" />
                                              View
                                            </Button>
                                          ) : (
                                            <span className="text-muted-foreground text-sm">
                                              No file
                                            </span>
                                          )}
                                        </div>
                                      </TableCell>
                                    </TableRow>
                                  ))}
                                </TableBody>
                              </Table>
                            </div>
                          ) : (
                            <p className="text-muted-foreground text-sm">No submissions yet.</p>
                          )}
                        </div>

                        {/* Comments Section */}
                        <div>
                          <h4 className="mb-2 flex items-center gap-2 font-medium">
                            <MessageSquare className="h-4 w-4" />
                            Discussion ({problemComments.length})
                          </h4>

                          {/* Existing Comments */}
                          {problemComments.length > 0 && (
                            <div className="mb-4 space-y-3">
                              {problemComments.map((comment) => (
                                <div key={comment.id} className="bg-card rounded-lg border p-3">
                                  <div className="mb-2 flex items-start justify-between">
                                    <div className="flex items-center gap-2">
                                      <span className="text-sm font-medium">
                                        {comment.authorName}
                                      </span>
                                      <RoleBadge role={comment.authorRole} />
                                    </div>
                                    <span className="text-muted-foreground text-xs">
                                      {formatDateTimeInTimeZone(comment.createdAt, timezone)}
                                    </span>
                                  </div>
                                  <p className="text-sm">{comment.content}</p>
                                </div>
                              ))}
                            </div>
                          )}

                          {/* Add New Comment */}
                          <div className="space-y-2">
                            <Textarea
                              placeholder="Add a comment or question about this problem..."
                              value={newComment[problemId] || ''}
                              onChange={(e) =>
                                setNewComment((prev) => ({ ...prev, [problemId]: e.target.value }))
                              }
                              hidden={assignment.course.isArchived}
                              className="min-h-[80px]"
                            />
                            <div className="flex justify-end">
                              <Button
                                size="sm"
                                onClick={() => handleSubmitComment(problemId)}
                                disabled={
                                  !newComment[problemId]?.trim() || submittingComment[problemId]
                                }
                                hidden={assignment.course.isArchived}
                              >
                                {submittingComment[problemId] ? (
                                  'Submitting...'
                                ) : (
                                  <>
                                    <Send className="mr-2 h-4 w-4" />
                                    Add Comment
                                  </>
                                )}
                              </Button>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {assignment.problems.length === 0 && (
        <Card>
          <CardContent className="pt-6">
            <p className="text-muted-foreground text-center">
              No problems have been added to this assignment yet.
            </p>
          </CardContent>
        </Card>
      )}
      {/* JffViewerDialog for viewing submitted files */}
      {openDialog.submission && ["FA", "PDA"].includes(assignment.problems.find(u => u.problemId === openDialog.submission.problemId).problem.type) && (
        <JffViewerDialog
          open={openDialog.open}
          onOpenChange={(open) => setOpenDialog({ open, submission: null })}
          src={`/api/uploads/submissions/${encodeURIComponent(openDialog.submission.fileName ?? '')}`}
          title={`${openDialog.submission.originalFileName || openDialog.submission.fileName} - Submission`}
          width="70vw"
          height="70vh"
        />
      )}
      {openDialog.submission && assignment.problems.find(u => u.problemId === openDialog.submission.problemId).problem.type === "RE" && (
	    <RegexViewerDialog
          open={openDialog.open}
          onOpenChange={(open) => setOpenDialog({ open, submission: null })}
          src={`/api/uploads/submissions/${encodeURIComponent(openDialog.submission.fileName ?? '')}`}
          title={`${openDialog.submission.originalFileName || openDialog.submission.fileName} - Submission`}
		/>
	  )}
      {openDialog.submission && assignment.problems.find(u => u.problemId === openDialog.submission.problemId).problem.type === "CFG" && (
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
