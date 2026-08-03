'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { ChevronDown, Download, ExternalLink, Eye, File, FileCode2, RotateCcw } from 'lucide-react';
import type { Course } from '@prisma/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { SubmissionViewerDialog } from '@/components/dialogs/SubmissionViewerDialog';
import { useEmptyStringSymbol } from '@/hooks/use-empty-string-symbol';
import { useEffectiveTimezone } from '@/hooks/use-effective-timezone';
import { CompactDate } from '@/components/ui/CompactDate';
import { FeedbackDialog } from '@/components/dialogs/FeedbackDialog';
import { SearchableMultiSelect } from '@/components/ui/SearchableMultiSelect';
import Link from 'next/link';
import { DataTable } from '@/components/ui/data-table';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { rerunSubmission } from '@/app/utils/rerunSubmission';
import { showToast } from '@/lib/toast';
import type { SubmissionStatusFilter } from '@/lib/submission-status-filter';
import type { ProblemSubmission } from '@/lib/problem-submission';
import { getTimingStatusChip, getReviewStatusChip } from '@/lib/submission-status';
import { StatusBadge } from '@/components/ui/status-badge';
import { apiPaths } from '@/lib/api-paths';
import { queryKeys } from '@/lib/query-keys';

type CourseItem = Pick<Course, 'id' | 'name' | 'code'>;

type AssignmentItem = {
  id: string;
  title: string;
  dueDate?: string;
  courseId: string;
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

/**
 * "Lastname, Firstname" for a submission's student, or null when neither is recorded.
 *
 * Sorted-by-surname order, because that is how a roster reads and how staff look someone
 * up. One name alone is returned on its own rather than left with a dangling comma.
 */
function formatStudentName(submission: {
  studentFirstName?: string | null;
  studentLastName?: string | null;
}): string | null {
  const first = submission.studentFirstName?.trim();
  const last = submission.studentLastName?.trim();
  if (last && first) return `${last}, ${first}`;
  return last || first || null;
}

const fetchCourseList = async (): Promise<CourseItem[]> => {
  const response = await fetch(apiPaths.myCourses());
  if (!response.ok) {
    throw new Error('Failed to load courses');
  }
  return (await response.json()) as CourseItem[];
};

const fetchAssignmentsForCourse = async (courseId: string): Promise<AssignmentItem[]> => {
  const response = await fetch(apiPaths.courseAssignments(courseId));
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
      courseId,
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

// Fan out across the selected courses / assignments for the filter lists.
const fetchAssignmentsForCourses = async (courseIds: string[]): Promise<AssignmentItem[]> => {
  const rows = await Promise.all(courseIds.map((id) => fetchAssignmentsForCourse(id)));
  return rows.flat();
};

const fetchProblemsForAssignments = async (assignmentIds: string[]): Promise<ProblemItem[]> => {
  const rows = await Promise.all(assignmentIds.map((id) => fetchProblemsForAssignment(id)));
  const flat = rows.flat();
  // Dedupe: the same problem can be attached to more than one assignment.
  return Array.from(new Map(flat.map((problem) => [problem.id, problem])).values());
};

// Stable empty arrays so `data ?? EMPTY` keeps a constant identity between
// renders: the selection-cascade effects depend on `[data]`, and a fresh `[]`
// each render would retrigger them endlessly.
const EMPTY_COURSES: CourseItem[] = [];
const EMPTY_ASSIGNMENTS: AssignmentItem[] = [];
const EMPTY_PROBLEMS: ProblemItem[] = [];

export default function AutograderQueueClient() {
  const [selectedCourses, setSelectedCourses] = useState<string[]>([]);
  const [selectedAssignments, setSelectedAssignments] = useState<string[]>([]);
  const [selectedProblems, setSelectedProblems] = useState<string[]>([]);
  // Only the setter is used: `rerunSubmission` flips a per-row flag while it works, and
  // nothing on this page reads it now that the bulk rerun button is gone.
  const [, setRerunning] = useState<Record<string, boolean>>({});
  const [feedbackDialogOpen, setFeedbackDialogOpen] = useState(false);
  const [activeFeedback, setActiveFeedback] = useState<string | null>(null);
  const [jffViewerOpen, setJffViewerOpen] = useState(false);
  const [jffViewerSrc, setJffViewerSrc] = useState<string | null>(null);
  const [jffViewerTitle, setJffViewerTitle] = useState<string | null>(null);
  const [jffViewerCourseId, setJffViewerCourseId] = useState<string | null>(null);
  const [viewerProblemType, setViewerProblemType] = useState<string | null>(null);
  const jffEpsSymbol = useEmptyStringSymbol(jffViewerCourseId);
  // This page spans every course, so there is no single course timezone to show dates in.
  // The viewer's own effective zone is the honest choice here; the course pages still show
  // each assignment in ITS course's zone.
  const { timezone } = useEffectiveTimezone();

  // --- Filter data (cascading: courses → assignments → problems) -------------
  // Each list is a cached, deduped, retried query. staleTime:Infinity means a
  // list only refetches when the selection above it changes (its key), so a
  // background refetch never re-runs the select-all cascade and wipes a manual
  // narrowing.
  const {
    data: courses = EMPTY_COURSES,
    isLoading: loadingCourses,
    isError: coursesError,
  } = useQuery({
    queryKey: queryKeys.admin.submissionFilters.courses(),
    queryFn: fetchCourseList,
    staleTime: Infinity,
  });

  const {
    data: assignments = EMPTY_ASSIGNMENTS,
    isFetching: loadingAssignments,
    isError: assignmentsError,
  } = useQuery({
    queryKey: queryKeys.admin.submissionFilters.assignments(selectedCourses),
    queryFn: () => fetchAssignmentsForCourses(selectedCourses),
    enabled: selectedCourses.length > 0,
    staleTime: Infinity,
  });

  const {
    data: problems = EMPTY_PROBLEMS,
    isFetching: loadingProblems,
    isError: problemsError,
  } = useQuery({
    queryKey: queryKeys.admin.submissionFilters.problems(selectedAssignments),
    queryFn: () => fetchProblemsForAssignments(selectedAssignments),
    enabled: selectedAssignments.length > 0,
    staleTime: Infinity,
  });

  // Selection cascade: each level auto-selects everything it just loaded, so the
  // page opens with all submissions in view and the user narrows from there.
  const allCoursesSelected = useRef(false);
  useEffect(() => {
    if (courses.length > 0 && !allCoursesSelected.current) {
      allCoursesSelected.current = true;
      setSelectedCourses(courses.map((course) => course.id));
    }
  }, [courses]);

  // When a new assignment list loads (the course selection changed), select all of
  // them. Seeding selectedProblems is deliberately left to the problems effect below:
  // doing it here as well meant both effects wrote selectedProblems (the submissions
  // query key) on load, firing the submissions POST twice.
  useEffect(() => {
    setSelectedAssignments(assignments.map((assignment) => assignment.id));
  }, [assignments]);

  // Sole seeder of selectedProblems — the deduped, canonical problem list for the
  // current assignment set (the same list the problem filter shows). Being the only
  // writer keeps the submissions query keyed on selectedProblems firing exactly once.
  useEffect(() => {
    setSelectedProblems(problems.map((problem) => problem.id));
  }, [problems]);

  useEffect(() => {
    if (coursesError) showToast.error('Could not load courses. Refresh the page to try again.');
  }, [coursesError]);

  useEffect(() => {
    if (assignmentsError)
      showToast.error('Could not load assignments. Refresh the page to try again.');
  }, [assignmentsError]);

  useEffect(() => {
    if (problemsError) showToast.error('Could not load problems. Refresh the page to try again.');
  }, [problemsError]);

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
      showToast.error('Could not load submissions. Refresh the page to try again.');
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
    // A submission's file is only a JFLAP machine for FA/PDA/TM; RE and CFG answers need
    // their own viewers. This page sent every one of them to the JFLAP viewer, so opening
    // a grammar or a regular expression produced a parse error instead of the answer.
    // The problem list is already loaded for the filter above, so read the type from it.
    setViewerProblemType(problems.find((p) => p.id === submission.problemId)?.type ?? null);
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

  /*
   * Rows the course / assignment / problem pickers allow through.
   *
   * Status filtering is NOT done here any more: the table owns it, through the `timing`
   * and `status` columns and the toolbar's Filters button. Note the consequence for the
   * header's Rerun button below, which reruns what this list holds and therefore ignores
   * a status filter set inside the table.
   */
  const visibleSubmissions = useMemo(
    () =>
      submissions.filter((submission) => {
        const matchesCourse =
          selectedCourses.length === 0 || selectedCourses.includes(submission.courseId);
        const matchesAssignment =
          selectedAssignments.length === 0 || selectedAssignments.includes(submission.assignmentId);
        const matchesProblem =
          selectedProblems.length === 0 || selectedProblems.includes(submission.problemId);

        return matchesCourse && matchesAssignment && matchesProblem;
      }),
    [selectedAssignments, selectedCourses, selectedProblems, submissions],
  );

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

  /** The assignment's due date for a row, or null when it has none or it is unparseable. */
  const dueDateFor = (submission: SubmissionItem): Date | null => {
    const assignment = assignments.find((a) => a.id === submission.assignmentId);
    const due = assignment?.dueDate ? new Date(assignment.dueDate) : null;
    return due && !Number.isNaN(due.getTime()) ? due : null;
  };

  /*
   * Columns for the shared DataTable.
   *
   * Date columns sort on a timestamp through `accessorFn` while rendering CompactDate, so
   * "newest first" orders by instant rather than by the formatted string. Text columns put
   * the value a person would search for in the accessor, which is what the toolbar's search
   * box reads. `priority` decides what survives on a narrow screen.
   */
  const columns: ColumnDef<SubmissionItem>[] = useMemo(
    () => [
      {
        id: 'submittedAt',
        header: 'Submitted',
        accessorFn: (s) => new Date(s.submittedAt).getTime(),
        cell: ({ row }) => <CompactDate value={row.original.submittedAt} timeZone={timezone} />,
        meta: { priority: 1 },
      },
      {
        id: 'timing',
        header: 'Timing',
        // Next to the timestamp it is a judgement about. Like Status, the accessor is the
        // chip's own label, so search, export and the mobile cards read "On time" rather
        // than a code, a row with no due date filters as the On time the grid already
        // calls it, and sorting is the plain A to Z of what the badge says (Late, then
        // On time) rather than an invented order a user would have to learn.
        accessorFn: (s) => {
          const due = dueDateFor(s);
          return getTimingStatusChip(s as ProblemSubmission, !!due, due).label;
        },
        cell: ({ row }) => {
          const due = dueDateFor(row.original);
          return (
            <StatusBadge chip={getTimingStatusChip(row.original as ProblemSubmission, !!due, due)} />
          );
        },
        meta: {
          priority: 2,
          filterVariant: 'multiselect',
          filterLabel: 'Timing',
          filterOptions: [
            { label: 'On time', value: 'On time' },
            { label: 'Late', value: 'Late' },
          ],
        },
      },
      {
        id: 'student',
        header: 'Student',
        // Both name and email, so either one finds the row from the search box.
        accessorFn: (s) => `${formatStudentName(s) ?? ''} ${s.studentEmail ?? ''}`.trim(),
        cell: ({ row }) => (
          <div className="min-w-0">
            <p className="text-foreground truncate text-sm">
              {formatStudentName(row.original) ?? row.original.studentEmail ?? 'Unknown'}
            </p>
            <p className="text-muted-foreground truncate text-xs">{row.original.studentEmail}</p>
          </div>
        ),
        meta: { priority: 1 },
      },
      {
        id: 'course',
        header: 'Course',
        accessorFn: (s) => s.courseName,
        cell: ({ row }) => (
          <Link
            href={`/dashboard/courses/${row.original.courseId}`}
            className="text-foreground text-sm hover:underline"
          >
            {row.original.courseName}
          </Link>
        ),
        meta: { priority: 3 },
      },
      {
        id: 'assignment',
        header: 'Assignment',
        accessorFn: (s) => s.assignmentTitle,
        cell: ({ row }) => (
          <Link
            href={`/dashboard/courses/${row.original.courseId}/${row.original.assignmentId}`}
            className="text-foreground text-sm hover:underline"
          >
            {row.original.assignmentTitle}
          </Link>
        ),
        meta: { priority: 3 },
      },
      {
        id: 'problem',
        header: 'Problem',
        accessorFn: (s) => s.problemTitle ?? s.problemId,
        cell: ({ row }) => (
          <Link
            href={`/dashboard/courses/${row.original.courseId}/${row.original.assignmentId}?tab=submissions&studentId=${encodeURIComponent(
              row.original.studentId,
            )}${row.original.problemId ? `&problemId=${encodeURIComponent(row.original.problemId)}` : ''}`}
            className="text-foreground text-sm hover:underline"
          >
            {row.original.problemTitle ?? row.original.problemId}
          </Link>
        ),
        meta: { priority: 2 },
      },
      {
        id: 'due',
        header: 'Due',
        accessorFn: (s) => dueDateFor(s)?.getTime() ?? 0,
        cell: ({ row }) => <CompactDate value={dueDateFor(row.original)} timeZone={timezone} />,
        meta: { priority: 3 },
      },
      {
        id: 'grade',
        header: 'Grade',
        accessorFn: (s) => s.grade ?? -1,
        cell: ({ row }) => {
          const { grade, maxPoints } = row.original;
          const text =
            maxPoints != null
              ? `${grade ?? '-'} / ${maxPoints}`
              : grade != null
                ? String(grade)
                : '-';
          return <span className="text-foreground text-sm whitespace-nowrap">{text}</span>;
        },
        meta: { priority: 2 },
      },
      {
        id: 'status',
        header: 'Status',
        /*
         * The grading result, next to the grade it explains. Accessor, sorting and filter
         * follow the Timing column above for the same reasons.
         *
         * Timing and Status stay separate columns on purpose: a submission has a timing
         * (was it late) AND a result (was it graded, and was it right), and those are
         * independent, so "late" and "correct" can describe the same row. Filters AND
         * across columns, which is what makes picking one of each narrow rather than
         * widen. Same reasoning the user table uses for keeping Lock apart from
         * Active/Inactive.
         */
        accessorFn: (s) => getReviewStatusChip(s as ProblemSubmission).label,
        cell: ({ row }) => (
          <StatusBadge chip={getReviewStatusChip(row.original as ProblemSubmission)} />
        ),
        meta: {
          priority: 1,
          filterVariant: 'multiselect',
          /*
           * One column, shown as two headings. Where it is up to (Pending / Processing /
           * Failed) and how it turned out (Correct / Incorrect) are different questions,
           * so they get their own lists. They stay one column because a submission has
           * exactly one of these five values: as separate columns the popover would AND
           * them, and any cross-heading pick (say Failed plus Correct) could only ever
           * return nothing. Sharing the column keeps that pick meaning "either".
           */
          filterSections: [
            {
              label: 'Status',
              options: [
                { label: 'Pending', value: 'Pending' },
                { label: 'Processing', value: 'Processing' },
                { label: 'Failed', value: 'Failed' },
              ],
            },
            {
              label: 'Submission',
              options: [
                { label: 'Correct', value: 'Correct' },
                { label: 'Incorrect', value: 'Incorrect' },
              ],
            },
          ],
        },
      },
      {
        id: 'actions',
        header: () => <span className="sr-only">Actions</span>,
        enableSorting: false,
        meta: { align: 'right', priority: 1 },
        cell: ({ row }) => {
          const submission = row.original;
          const busy =
            submission.status?.toLowerCase() === 'pending' ||
            submission.status?.toLowerCase() === 'processing';
          const student = formatStudentName(submission) ?? submission.studentEmail;
          const reviewHref = `/dashboard/courses/${submission.courseId}/${submission.assignmentId}?tab=submissions&studentId=${encodeURIComponent(
            submission.studentId,
          )}${submission.problemId ? `&problemId=${encodeURIComponent(submission.problemId)}` : ''}`;
          return (
            <div className="flex justify-end">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="secondary"
                    size="sm"
                    aria-label={`Manage submission by ${student}`}
                  >
                    <ChevronDown />
                    Manage
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuLabel className="flex items-center gap-2">
                    <FileCode2 className="h-4 w-4" />
                    {submission.problemTitle ?? submission.problemId}
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={() => handleViewSubmission(submission)}
                    disabled={!submission.fileName}
                    className="flex items-center gap-2"
                  >
                    <Eye className="h-4 w-4" />
                    View submission
                  </DropdownMenuItem>
                  {/* Opens the assignment's own review screen, where the submission sits
                      alongside the grade box and the discussion, rather than the read-only
                      dialog above. */}
                  <DropdownMenuItem asChild className="flex items-center gap-2">
                    <Link href={reviewHref}>
                      <ExternalLink className="h-4 w-4" />
                      Open in submission review
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => handleViewFeedback(submission)}
                    disabled={!submission.feedback || busy}
                    className="flex items-center gap-2"
                  >
                    <File className="h-4 w-4" />
                    View feedback
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => handleDownloadSubmission(submission)}
                    disabled={!submission.fileName}
                    className="flex items-center gap-2"
                  >
                    <Download className="h-4 w-4" />
                    Download
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={() => handleRerunSubmission(submission)}
                    disabled={busy}
                    className="flex items-center gap-2"
                  >
                    <RotateCcw className="h-4 w-4" />
                    Rerun
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          );
        },
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [assignments, timezone],
  );

  return (
    <Card className="p-4">
      <CardHeader className="pb-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <CardTitle role="heading" aria-level={1} className="text-2xl">
              Autograder Queue
            </CardTitle>
          </div>
          {/* No bulk rerun here. It re-ran whatever the page's own selection held, which
              stopped matching what the table showed once status filtering moved into the
              table, so the button could not honestly describe what it was about to do.
              Rerunning one submission lives in its row's Manage menu. */}
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
        {/* Stacked until there is genuinely room for three. Three equal tracks at the `sm`
            breakpoint left each filter narrower than its own label, so they now go side by
            side only from `lg`. Each track is `minmax(0,1fr)` so a long selection truncates
            inside its column instead of widening it. */}
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)]">
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

        <DataTable
          columns={columns}
          data={visibleSubmissions}
          loading={loadingCourses || loadingAssignments || loadingSubmissions}
          loadingMessage="Loading submissions, please wait..."
          // Suffixed because the column set changed: a saved layout wins over these
          // defaults, so browsers holding the old one would keep hiding Timing and Status.
          storageKey="autograder-queue-columns-v2"
          tableLabel="Autograder queue"
          // Due is off by default: the deadline matters far less than arrival order when
          // you are working a queue, and the Timing column already flags late work. The
          // Columns menu turns it back on, and that choice is remembered per browser.
          defaultColumnVisibility={{ due: false }}
          emptyIcon={FileCode2}
          {...(submissions.length === 0
            ? {
                emptyTitle: 'No submissions yet',
                emptyDescription: 'Work submitted for a problem will show up here.',
              }
            : {
                // Distinguish "nothing has been submitted" from "your filters hide
                // everything": the fix for the second is a filter change, not more work.
                emptyTitle: 'No submissions match your filters',
                emptyDescription: 'Try clearing a course, assignment, problem or status filter.',
              })}
          // Newest first: a queue is read from the most recent arrival down.
          defaultSorting={[{ id: 'submittedAt', desc: true }]}
        />
        <SubmissionViewerDialog
          open={jffViewerOpen}
          onOpenChange={(open) => {
            setJffViewerOpen(open);
            if (!open) {
              setJffViewerSrc(null);
              setJffViewerTitle(null);
              setJffViewerCourseId(null);
              setViewerProblemType(null);
            }
          }}
          problemType={viewerProblemType}
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
