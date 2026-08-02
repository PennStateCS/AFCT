'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { Download, Eye, File, FileCode2, RotateCcw } from 'lucide-react';
import type { Course } from '@prisma/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { SubmissionViewerDialog } from '@/components/dialogs/SubmissionViewerDialog';
import { useEmptyStringSymbol } from '@/hooks/use-empty-string-symbol';
import { useEffectiveTimezone } from '@/hooks/use-effective-timezone';
import { CompactDate } from '@/components/ui/CompactDate';
import { FeedbackDialog } from '@/components/dialogs/FeedbackDialog';
import { ConfirmDialog } from '@/components/dialogs/ConfirmDialog';
import { SearchableMultiSelect } from '@/components/ui/SearchableMultiSelect';
import Link from 'next/link';
import { DataTable } from '@/components/ui/data-table';
import { rerunSubmission } from '@/app/utils/rerunSubmission';
import { rerunVisibleSubmissions } from '@/app/utils/rerunVisibleSubmissions';
import { showToast } from '@/lib/toast';
import type { SubmissionStatusFilter } from '@/lib/submission-status-filter';
import { filterSubmissions, STATUS_FILTER_OPTIONS } from '@/lib/submission-status-filter';
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
  const [activeFilters, setActiveFilters] = useState<Set<SubmissionStatusFilter>>(new Set());
  const [rerunning, setRerunning] = useState<Record<string, boolean>>({});
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
  const isRerunning = useMemo(() => Object.values(rerunning).some(Boolean), [rerunning]);
  const [rerunConfirmOpen, setRerunConfirmOpen] = useState(false);

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
        enableSorting: false,
        cell: ({ row }) => {
          const due = dueDateFor(row.original);
          const chips = [
            getTimingStatusChip(row.original as ProblemSubmission, !!due, due),
            getReviewStatusChip(row.original as ProblemSubmission),
          ];
          return (
            <div className="flex flex-col gap-1">
              {chips.map((chip) => (
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
        },
        meta: { priority: 1 },
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
          return (
            <div className="flex items-center justify-end gap-2 whitespace-nowrap">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => handleViewFeedback(submission)}
                title="View feedback"
                aria-label="View submission feedback"
                className="h-8 w-8 p-0"
                disabled={!submission.feedback || busy}
              >
                <File className="h-4 w-4" />
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => handleViewSubmission(submission)}
                title="View submission"
                aria-label="View submission"
                disabled={!submission.fileName}
                className="h-8 w-8 p-0"
              >
                <Eye className="h-4 w-4" />
              </Button>
              <Button
                type="button"
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
                type="button"
                variant="secondary"
                size="sm"
                disabled={busy}
                title="Rerun submission"
                aria-label="Rerun submission"
                className="h-8 w-8 p-0"
                onClick={() => handleRerunSubmission(submission)}
              >
                <RotateCcw className="h-4 w-4" />
              </Button>
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
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setRerunConfirmOpen(true)}
            disabled={visibleSubmissions.length === 0 || isRerunning}
            className="whitespace-nowrap"
          >
            {isRerunning ? 'Rerunning…' : 'Rerun'}
          </Button>

          <ConfirmDialog
            open={rerunConfirmOpen}
            busy={isRerunning}
            title="Rerun all visible submissions?"
            description={`This re-runs the autograder on all ${visibleSubmissions.length} submission${
              visibleSubmissions.length === 1 ? '' : 's'
            } currently shown. Autograded results may change.`}
            confirmText="Rerun all"
            onConfirm={async () => {
              await handleRerunVisible();
              setRerunConfirmOpen(false);
            }}
            onCancel={() => setRerunConfirmOpen(false)}
          />
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

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              aria-pressed={activeFilters.size === 0}
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
                  aria-pressed={active}
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

        <DataTable
          columns={columns}
          data={visibleSubmissions}
          loading={loadingCourses || loadingAssignments || loadingSubmissions}
          loadingMessage="Loading submissions, please wait..."
          storageKey="autograder-queue-columns"
          tableLabel="Autograder queue"
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
