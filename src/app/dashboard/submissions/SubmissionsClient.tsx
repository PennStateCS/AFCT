'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download, Eye, File, RotateCcw } from 'lucide-react';
import type { Course } from '@prisma/client';
import { getInitials } from '@/app/utils/initials';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import JffViewerDialog from '@/components/JffViewerDialog';
import { useEmptyStringSymbol } from '@/lib/useEmptyStringSymbol';
import { FeedbackDialog } from '@/components/dialogs/FeedbackDialog';
import { SearchableMultiSelect } from '@/components/ui/SearchableMultiSelect';
import Link from 'next/link';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { rerunSubmission } from '@/app/utils/rerunSubmission';
import { rerunVisibleSubmissions } from '@/app/utils/rerunVisibleSubmissions';
import { showToast } from '@/lib/toast';
import {
  filterSubmissions,
  STATUS_FILTER_OPTIONS,
  SubmissionStatusFilter,
} from '@/lib/submission-status-filter';
import type { ProblemSubmission } from '@/lib/problem-submission';
import { statusToneClass, getTimingStatusChip, getReviewStatusChip } from '@/lib/submission-status';
import { apiPaths } from '@/lib/api-paths';
import { queryKeys } from '@/lib/query-keys';

type CourseItem = Pick<Course, 'id' | 'name' | 'code'>;

type AssignmentItem = {
  id: string;
  title: string;
  dueDate?: string;
  courseId: string;
  courseName: string;
  problems: string[];
};

type SubmissionItem = {
  id: string;
  studentId: string;
  courseId: string;
  assignmentId: string;
  problemId: string;
  studentFirstName?: string | null;
  studentLastName?: string | null;
  studentEmail: string;
  courseName: string;
  assignmentTitle: string;
  submittedAt: string;
  status: SubmissionStatusFilter;
  grade?: number | null;
  correct?: boolean | null;
  maxPoints?: number | null;
  problemTitle?: string | null;
  avatar?: string | null;
  fileName?: string | null;
  originalFileName?: string | null;
  feedback: string;
};

type ProblemItem = {
  id: string;
  title: string;
  description: string | null;
  type: string | null;
  maxPoints: number | null;
  maxStates: number | null;
  isDeterministic: boolean | null;
  solved: boolean;
  grade: number | null;
};

const fetchCourseList = async (): Promise<CourseItem[]> => {
  const response = await fetch(apiPaths.myCourses());
  if (!response.ok) {
    throw new Error('Failed to load courses');
  }
  return (await response.json()) as CourseItem[];
};

const fetchAssignmentsForCourse = async (course: CourseItem): Promise<AssignmentItem[]> => {
  const response = await fetch(apiPaths.courseAssignments(course.id));
  if (!response.ok) return [];

  const assignments = (await response.json()) as Array<{
    id: string;
    title: string;
    dueDate?: string;
    problems?: Array<{
      problemId: string;
      maxPoints: number;
    }>;
  }>;

  return assignments.map((assignment) => {
    const problems = Array.isArray(assignment.problems) ? assignment.problems : [];
    return {
      id: assignment.id,
      title: assignment.title,
      dueDate: assignment.dueDate,
      courseId: course.id,
      courseName: course.name,
      problems: problems.map((problem) => problem.problemId),
    };
  });
};

const fetchProblemsForAssignment = async (assignmentId: string): Promise<ProblemItem[]> => {
  const response = await fetch(apiPaths.assignmentByIdProblems(assignmentId));

  if (!response.ok) {
    return [];
  }

  const problems = (await response.json()) as Array<{
    id: string;
    title: string;
    description: string | null;
    type: string | null;
    maxPoints: number | null;
    maxStates: number | null;
    isDeterministic: boolean | null;
    solved: boolean;
    grade: number | null;
  }>;

  return problems.map((problem) => ({
    id: problem.id,
    title: problem.title,
    description: problem.description,
    type: problem.type,
    maxPoints: problem.maxPoints,
    maxStates: problem.maxStates,
    isDeterministic: problem.isDeterministic,
    solved: problem.solved,
    grade: problem.grade,
  }));
};

const fetchSubmissions = async (problemIds: string[]): Promise<SubmissionItem[]> => {
  if (problemIds.length === 0) return [];

  const response = await fetch(apiPaths.admin.submissions(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ problemIds }),
  });

  if (!response.ok) {
    throw new Error('Failed to load submissions');
  }

  return (await response.json()) as SubmissionItem[];
};

export default function SubmissionsClient() {
  const [courses, setCourses] = useState<CourseItem[]>([]);
  const [assignments, setAssignments] = useState<AssignmentItem[]>([]);
  const [problems, setProblems] = useState<ProblemItem[]>([]);
  const [selectedCourses, setSelectedCourses] = useState<string[]>([]);
  const [selectedAssignments, setSelectedAssignments] = useState<string[]>([]);
  const [selectedProblems, setSelectedProblems] = useState<string[]>([]);
  const [activeFilters, setActiveFilters] = useState<Set<SubmissionStatusFilter>>(new Set());
  const [loadingCourses, setLoadingCourses] = useState(false);
  const [loadingAssignments, setLoadingAssignments] = useState(false);
  const [loadingProblems, setLoadingProblems] = useState(false);
  const [rerunning, setRerunning] = useState<Record<string, boolean>>({});
  const [feedbackDialogOpen, setFeedbackDialogOpen] = useState(false);
  const [activeFeedback, setActiveFeedback] = useState<string | null>(null);
  const [jffViewerOpen, setJffViewerOpen] = useState(false);
  const [jffViewerSrc, setJffViewerSrc] = useState<string | null>(null);
  const [jffViewerTitle, setJffViewerTitle] = useState<string | null>(null);
  const [jffViewerCourseId, setJffViewerCourseId] = useState<string | null>(null);
  const jffEpsSymbol = useEmptyStringSymbol(jffViewerCourseId);
  const isRerunning = useMemo(() => Object.values(rerunning).some(Boolean), [rerunning]);

  // Cached submissions list keyed by the selected problem set. The query varies
  // with `selectedProblems`, so changing any course/assignment/problem filter
  // (which cascades into `selectedProblems`) refetches automatically and dedupes
  // identical requests. An empty selection resolves to [] without a network call.
  const {
    data: submissions = [],
    isFetching: loadingSubmissions,
    isError: submissionsError,
    refetch: refetchSubmissions,
  } = useQuery({
    queryKey: queryKeys.admin.submissions(selectedProblems),
    queryFn: () => fetchSubmissions(selectedProblems),
  });

  useEffect(() => {
    if (submissionsError) {
      showToast.error('Unable to load submissions');
    }
  }, [submissionsError]);

  const fetchReviewData = async (): Promise<void> => {
    await refetchSubmissions();
  };

  const handleViewFeedback = (submission: SubmissionItem) => {
    setActiveFeedback(String(submission.feedback));
    setFeedbackDialogOpen(true);
  };

  const handleViewSubmission = (submission: SubmissionItem) => {
    if (!submission.fileName) return;

    setJffViewerSrc(apiPaths.files.submission(encodeURIComponent(submission.fileName)));
    setJffViewerTitle(submission.originalFileName || submission.fileName);
    setJffViewerCourseId(submission.courseId ?? null);
    setJffViewerOpen(true);
  };

  const handleDownloadSubmission = (submission: SubmissionItem) => {
    if (!submission.fileName) return;

    const url = apiPaths.files.submission(encodeURIComponent(submission.fileName));
    const link = document.createElement('a');
    link.href = url;
    link.download = submission.originalFileName || 'Download';
    link.click();
  };

  useEffect(() => {
    const loadCourses = async () => {
      setLoadingCourses(true);
      try {
        const courseList = await fetchCourseList();
        setCourses(courseList);
        setSelectedCourses(courseList.map((course) => course.id));
      } catch (error) {
        console.error(error);
        showToast.error('Unable to load courses');
      } finally {
        setLoadingCourses(false);
      }
    };
    void loadCourses();
  }, []);

  useEffect(() => {
    const loadAssignments = async () => {
      if (selectedCourses.length === 0) {
        setAssignments([]);
        setSelectedAssignments([]);
        setSelectedProblems([]);
        return;
      }

      setLoadingAssignments(true);
      try {
        const rows = await Promise.all(
          selectedCourses.map(async (courseId) => {
            const course = courses.find((item) => item.id === courseId);
            if (!course) return [] as AssignmentItem[];
            return fetchAssignmentsForCourse(course);
          }),
        );
        const flat = rows.flat();
        setAssignments(flat);

        const allAssignmentIds = flat.map((assignment) => assignment.id);
        const allProblemIds = flat.flatMap((assignment) => assignment.problems);

        setSelectedAssignments(allAssignmentIds);
        setSelectedProblems(allProblemIds);
      } catch (error) {
        console.error(error);
        showToast.error('Unable to load assignments');
        setAssignments([]);
      } finally {
        setLoadingAssignments(false);
      }
    };
    void loadAssignments();
  }, [selectedCourses, courses]);

  useEffect(() => {
    const loadProblems = async () => {
      if (selectedAssignments.length === 0) {
        setProblems([]);
        setSelectedProblems([]);
        return;
      }

      setLoadingProblems(true);
      setSelectedProblems([]);
      try {
        const rows = await Promise.all(
          selectedAssignments.map((assignmentId) => fetchProblemsForAssignment(assignmentId)),
        );
        const flat = rows.flat();
        const deduped = Array.from(new Map(flat.map((problem) => [problem.id, problem])).values());
        setProblems(deduped);
        setSelectedProblems(deduped.map((problem) => problem.id));
      } catch (error) {
        console.error(error);
        showToast.error('Unable to load problems');
        setProblems([]);
        setSelectedProblems([]);
      } finally {
        setLoadingProblems(false);
      }
    };

    void loadProblems();
  }, [selectedAssignments]);

  const courseOptions = useMemo(
    () =>
      courses.map((course) => ({ id: course.id, label: course.name ?? course.code ?? course.id })),
    [courses],
  );

  const assignmentOptions = useMemo(
    () =>
      assignments
        .map((assignment) => ({ id: assignment.id, label: assignment.title }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [assignments],
  );

  const problemOptions = useMemo(
    () =>
      problems
        .map((problem) => ({ id: problem.id, label: problem.title || problem.id }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [problems],
  );

  const visibleSubmissions = useMemo(
    () =>
      submissions.filter((submission) => {
        const matchesCourse =
          selectedCourses.length === 0 || selectedCourses.includes(submission.courseId);
        const matchesAssignment =
          selectedAssignments.length === 0 || selectedAssignments.includes(submission.assignmentId);
        const matchesProblem =
          selectedProblems.length === 0 || selectedProblems.includes(submission.problemId);

        const assignment = assignments.find((item) => item.id === submission.assignmentId);
        const dueDate = assignment?.dueDate ? new Date(assignment.dueDate) : null;
        const hasValidDueDate = dueDate instanceof Date && !Number.isNaN(dueDate.getTime());
        const matchesFilter =
          activeFilters.size === 0 ||
          filterSubmissions([submission], activeFilters, dueDate, hasValidDueDate).length > 0;

        return matchesCourse && matchesAssignment && matchesProblem && matchesFilter;
      }),
    [
      activeFilters,
      assignments,
      selectedAssignments,
      selectedCourses,
      selectedProblems,
      submissions,
    ],
  );

  const toggleFilter = (filter: SubmissionStatusFilter) => {
    setActiveFilters((prev) => {
      const next = new Set(prev);
      if (next.has(filter)) next.delete(filter);
      else next.add(filter);
      return next;
    });
  };

  const handleSelectAll = () => {
    setSelectedCourses(courses.map((course) => course.id));
    setSelectedAssignments(assignments.map((assignment) => assignment.id));
    setSelectedProblems(problems.map((problem) => problem.id));
  };

  const handleClearFilters = () => {
    setSelectedCourses([]);
    setSelectedAssignments([]);
    setSelectedProblems([]);
  };

  const handleRerunSubmission = async (submission: SubmissionItem) => {
    await rerunSubmission({
      submission: submission as unknown as Parameters<typeof rerunSubmission>[0]['submission'],
      setRerunning,
      fetchReviewData,
    });
  };

  const handleRerunVisible = async () => {
    if (visibleSubmissions.length === 0) return;

    await rerunVisibleSubmissions({
      visibleSubmissions,
      setRerunning,
      fetchReviewData,
    });
  };

  return (
    <Card className="p-4">
      <CardHeader className="pb-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <CardTitle role="heading" aria-level={1} className="text-2xl">
              System Submission Logs
            </CardTitle>
          </div>
          <Button
            size="sm"
            variant="secondary"
            onClick={handleRerunVisible}
            disabled={visibleSubmissions.length === 0 || isRerunning}
            className="whitespace-nowrap"
          >
            {isRerunning ? 'Rerunning…' : 'Rerun'}
          </Button>
        </div>

        <div className="mt-3 flex gap-2">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={handleSelectAll}
            disabled={courses.length === 0}
          >
            Select All
          </Button>

          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={handleClearFilters}
            disabled={
              selectedCourses.length === 0 &&
              selectedAssignments.length === 0 &&
              selectedProblems.length === 0
            }
          >
            Clear Filters
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-[1fr_1fr_1fr]">
          <SearchableMultiSelect
            label="Course filter"
            items={courseOptions}
            value={selectedCourses}
            onChange={setSelectedCourses}
            placeholder={loadingCourses ? 'Loading courses…' : 'No selected courses'}
            searchPlaceholder="Search courses"
            emptyStateText={loadingCourses ? 'Loading courses…' : 'No courses found.'}
            disabled={loadingCourses}
          />
          <SearchableMultiSelect
            label="Assignment filter"
            items={assignmentOptions}
            value={selectedAssignments}
            onChange={setSelectedAssignments}
            placeholder={loadingAssignments ? 'Loading assignments…' : 'No selected assignments'}
            searchPlaceholder="Search assignments"
            emptyStateText={loadingAssignments ? 'Loading assignments…' : 'No assignments found.'}
            disabled={loadingAssignments || selectedCourses.length === 0}
          />
          <SearchableMultiSelect
            label="Problem filter"
            items={problemOptions}
            value={selectedProblems}
            onChange={setSelectedProblems}
            placeholder={loadingProblems ? 'Loading problems…' : 'No selected problems'}
            searchPlaceholder="Search problems"
            emptyStateText={loadingProblems ? 'Loading problems…' : 'No problems found.'}
            disabled={loadingProblems || selectedAssignments.length === 0}
          />
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setActiveFilters(new Set())}
              className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
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
                  type="button"
                  onClick={() => toggleFilter(value)}
                  className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                    active
                      ? 'border-foreground bg-foreground text-background'
                      : 'border-border text-muted-foreground hover:border-foreground/50 hover:text-foreground'
                  }`}
                >
                  <span
                    className={`inline-flex h-2.5 w-2.5 rounded-full ${dot}`}
                    aria-hidden="true"
                  />
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="overflow-x-auto rounded-md border">
          <Table className="text-sm">
            <TableHeader>
              <TableRow>
                <TableHead className="px-2 py-1">Student</TableHead>
                <TableHead className="px-2 py-1">Course</TableHead>
                <TableHead className="px-2 py-1">Assignment</TableHead>
                <TableHead className="px-2 py-1">Problem</TableHead>
                <TableHead className="px-2 py-1">Due</TableHead>
                <TableHead className="px-2 py-1">Grade</TableHead>
                <TableHead className="px-2 py-1">Status</TableHead>
                <TableHead className="px-2 py-1">Manage</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleSubmissions.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-muted-foreground py-8 text-center text-sm">
                    {loadingCourses || loadingAssignments || loadingSubmissions
                      ? 'Loading submissions...'
                      : 'No submissions match your current filters.'}
                  </TableCell>
                </TableRow>
              ) : (
                visibleSubmissions.map((submission) => {
                  const assignment = assignments.find(
                    (assignment) => assignment.id === submission.assignmentId,
                  );
                  const dueDate = assignment?.dueDate ? new Date(assignment.dueDate) : null;
                  const hasValidDueDate =
                    dueDate instanceof Date && !Number.isNaN(dueDate.getTime());

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
                    <TableRow key={submission.id} className="hover:bg-[var(--table-highlight)]">
                      <TableCell className="p-1 align-top">
                        <div className="flex min-w-0 items-center gap-3">
                          <div className="relative h-11 w-11 shrink-0">
                            <Avatar className="h-11 w-11">
                              <AvatarImage
                                src={
                                  submission.avatar
                                    ? apiPaths.files.pfp(submission.avatar)
                                    : undefined
                                }
                                alt={submission.studentEmail || submission.studentId || 'User'}
                              />
                              <AvatarFallback className="bg-secondary text-secondary-foreground text-xs">
                                {getInitials(
                                  submission.studentFirstName,
                                  submission.studentLastName,
                                  submission.studentEmail,
                                )}
                              </AvatarFallback>
                            </Avatar>
                          </div>

                          <div className="min-w-0">
                            <p className="text-foreground text-sm">
                              {submission.studentEmail ?? submission.studentId ?? 'Unknown'}
                            </p>
                            <p className="text-muted-foreground text-xs">{submission.studentId}</p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="p-1 align-top">
                        <div className="min-w-0">
                          <Link
                            href={`/dashboard/courses/${submission.courseId}`}
                            className="text-foreground text-sm hover:underline"
                          >
                            {submission.courseName}
                          </Link>
                          <p className="text-muted-foreground text-xs">{submission.courseId}</p>
                        </div>
                      </TableCell>
                      <TableCell className="p-1 align-top">
                        <div className="min-w-0">
                          <Link
                            href={`/dashboard/courses/${submission.courseId}/${submission.assignmentId}`}
                            className="text-foreground text-sm hover:underline"
                          >
                            {submission.assignmentTitle}
                          </Link>
                          <p className="text-muted-foreground text-xs">{submission.assignmentId}</p>
                        </div>
                      </TableCell>
                      <TableCell className="p-1 align-top">
                        <div className="min-w-0">
                          <Link
                            href={`/dashboard/courses/${submission.courseId}/${submission.assignmentId}?tab=submissions&studentId=${encodeURIComponent(
                              submission.studentId,
                            )}${submission.problemId ? `&problemId=${encodeURIComponent(submission.problemId)}` : ''}`}
                            className="text-foreground text-sm hover:underline"
                          >
                            {submission.problemTitle ?? submission.problemId}
                          </Link>
                          <p className="text-muted-foreground text-xs">{submission.problemId}</p>
                        </div>
                      </TableCell>
                      <TableCell className="p-1 align-top">
                        <div className="min-w-0">
                          <p className="text-foreground text-sm">
                            {submission.submittedAt
                              ? new Date(submission.submittedAt).toLocaleDateString()
                              : 'Unknown'}
                          </p>
                        </div>
                      </TableCell>
                      <TableCell className="p-1 align-top">
                        <div className="min-w-0">
                          <p className="text-foreground text-sm">
                            {submission.maxPoints != null
                              ? submission.grade != null
                                ? `${submission.grade} / ${submission.maxPoints}`
                                : `- / ${submission.maxPoints}`
                              : submission.grade != null
                                ? String(submission.grade)
                                : '-'}
                          </p>
                        </div>
                      </TableCell>
                      <TableCell className="p-1 align-top">
                        {renderStatusCell(submission)}
                      </TableCell>
                      <TableCell className="p-1 align-top">
                        <div className="flex items-center gap-2 whitespace-nowrap">
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => handleViewFeedback(submission)}
                            title="View feedback"
                            aria-label="View submission feedback"
                            className="h-8 w-8 p-0"
                            disabled={
                              !submission.feedback ||
                              submission.status?.toLowerCase() === 'pending' ||
                              submission.status?.toLowerCase() === 'processing'
                            }
                          >
                            <File className="h-4 w-4" />
                          </Button>

                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => handleViewSubmission(submission)}
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
                            onClick={() => handleDownloadSubmission(submission)}
                            title="Download submission"
                            aria-label="Download submission"
                            className="h-8 w-8 p-0"
                          >
                            <Download className="h-4 w-4" />
                          </Button>

                          <Button
                            variant="secondary"
                            size="sm"
                            disabled={
                              submission.status?.toLowerCase() === 'pending' ||
                              submission.status?.toLowerCase() === 'processing'
                            }
                            title="Rerun submission"
                            aria-label="Rerun submission"
                            className="h-8 w-8 p-0"
                            onClick={() => handleRerunSubmission(submission)}
                          >
                            <RotateCcw className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
        <JffViewerDialog
          open={jffViewerOpen}
          onOpenChange={(open) => {
            setJffViewerOpen(open);
            if (!open) {
              setJffViewerSrc(null);
              setJffViewerTitle(null);
              setJffViewerCourseId(null);
            }
          }}
          src={jffViewerSrc ?? ''}
          title={jffViewerTitle ?? 'Submission'}
          epsSymbol={jffEpsSymbol}
        />

        <FeedbackDialog
          open={feedbackDialogOpen}
          onOpenChange={setFeedbackDialogOpen}
          feedbackText={activeFeedback}
        />
      </CardContent>
    </Card>
  );
}
