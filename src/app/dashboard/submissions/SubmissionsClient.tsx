'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import type { ColumnDef, OnChangeFn, PaginationState, SortingState } from '@tanstack/react-table';
import {
  ChevronDown,
  Download,
  ExternalLink,
  Eye,
  File,
  FileCode2,
  RotateCcw,
  User,
  Users,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
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
import { DataTableFilterMenu } from '@/components/ui/data-table-faceted-filter';
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

// Shape returned by POST /api/admin/submissions (one page of rows). `dueDate` and
// `problemType` come from the server so a row is self-describing: the table no longer has
// to look its assignment or problem up in the picker lists, which held only the current
// selection and quietly returned nothing for anything outside it.
type SubmissionItem = {
  id: string;
  /** False when the problem is hand-graded, so there is no queue state to report. */
  autograderEnabled: boolean;
  /** True when the assignment is group work. */
  isGroupAssignment: boolean;
  studentId: string;
  courseId: string;
  assignmentId: string;
  problemId: string;
  studentFirstName?: string | null;
  studentLastName?: string | null;
  studentEmail: string;
  courseName: string;
  assignmentTitle: string;
  dueDate: string;
  problemType: string | null;
  submittedAt: string;
  status: SubmissionStatusFilter;
  grade?: number | null;
  correct?: boolean | null;
  maxPoints?: number | null;
  problemTitle?: string | null;
  fileName?: string | null;
  originalFileName?: string | null;
  feedback: string | null;
};

/** The server-side query: sent as the request body and used as the react-query key. */
type SubmissionsQuery = {
  courseIds: string[];
  assignmentIds: string[];
  problemIds: string[];
  q?: string;
  field: string;
  timing: string[];
  status: string[];
  page: number;
  pageSize: number;
  sortBy?: string;
  sortDir: 'asc' | 'desc';
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

/**
 * Points this one attempt earned, or null while it has no result.
 *
 * Mirrors what the submission worker writes when it grades: a correct attempt earns the
 * problem's full points and an incorrect one earns zero. Kept in step with
 * `submission-worker.ts` if that ever stops being all-or-nothing.
 */
function attemptPointsFor(submission: SubmissionItem): number | null {
  if (submission.correct == null) return null;
  return submission.correct ? (submission.maxPoints ?? 0) : 0;
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

const fetchSubmissions = async (
  query: SubmissionsQuery,
): Promise<{ rows: SubmissionItem[]; total: number }> => {
  const response = await fetch(apiPaths.admin.submissions(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(query),
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error('Failed to load submissions');
  }

  return (await response.json()) as { rows: SubmissionItem[]; total: number };
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

// Stable empty arrays so `data ?? EMPTY` keeps a constant identity between renders, which
// keeps the option memos below from rebuilding on every render.
const EMPTY_COURSES: CourseItem[] = [];
const EMPTY_ASSIGNMENTS: AssignmentItem[] = [];
const EMPTY_PROBLEMS: ProblemItem[] = [];
const EMPTY_ROWS: SubmissionItem[] = [];

const DEFAULT_PAGE_SIZE = 10;

// Search scope (server-side): restrict the text search to one field.
const SEARCH_FIELDS = [
  { value: 'all', label: 'All fields' },
  { value: 'student', label: 'Student' },
  { value: 'course', label: 'Course' },
  { value: 'assignment', label: 'Assignment' },
  { value: 'problem', label: 'Problem' },
  { value: 'file', label: 'File' },
];

export default function SubmissionsClient() {
  // Scope. Empty means "everything", so the page opens unfiltered without enumerating every
  // id in the installation, and the assignment/problem lists are only fetched once the admin
  // actually narrows. Selecting all of them used to fan out one request per course and then
  // one per assignment before the table could show anything.
  const [selectedCourses, setSelectedCourses] = useState<string[]>([]);
  const [selectedAssignments, setSelectedAssignments] = useState<string[]>([]);
  const [selectedProblems, setSelectedProblems] = useState<string[]>([]);

  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);

  // searchInput is what the user is typing; search is the committed (debounced) query.
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [searchField, setSearchField] = useState('all');

  // Server-side multi-selects. Values match the API's query tokens.
  const [timing, setTiming] = useState<string[]>([]);
  const [statusFilter, setStatusFilter] = useState<string[]>([]);

  // Newest first: a queue is read from the most recent arrival down.
  const [sorting, setSorting] = useState<SortingState>([{ id: 'submittedAt', desc: true }]);
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

  // Narrowing a level clears the levels below it, so a stale assignment or problem id
  // cannot outlive the course that offered it and silently keep filtering the table.
  useEffect(() => {
    setSelectedAssignments((prev) =>
      prev.filter((id) => assignments.some((assignment) => assignment.id === id)),
    );
  }, [assignments]);

  useEffect(() => {
    setSelectedProblems((prev) => prev.filter((id) => problems.some((p) => p.id === id)));
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

  // Debounce typing, and jump back to the first page when the query changes.
  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(searchInput.trim());
      setPageIndex(0);
    }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const sort = sorting[0];
  // One serializable object, used as both the react-query key and the request body, so the
  // cache can never disagree with what was actually asked for.
  const submissionsQuery: SubmissionsQuery = {
    courseIds: selectedCourses,
    assignmentIds: selectedAssignments,
    problemIds: selectedProblems,
    q: search || undefined,
    field: searchField,
    timing,
    status: statusFilter,
    page: pageIndex + 1,
    pageSize,
    sortBy: sort?.id,
    sortDir: sort?.desc === false ? 'asc' : 'desc',
  };

  // One page of submissions. keepPreviousData holds the current page on screen while the
  // next one loads, so paging does not flash an empty table.
  const {
    data,
    // The blocking placeholder is for the cold first load only. Using `isFetching` here
    // would render it on every page, search and sort change, which is exactly what
    // keepPreviousData exists to avoid.
    isLoading: loadingSubmissions,
    isError: submissionsError,
    refetch: refetchSubmissions,
  } = useQuery({
    queryKey: queryKeys.admin.submissions(submissionsQuery),
    queryFn: () => fetchSubmissions(submissionsQuery),
    placeholderData: keepPreviousData,
  });

  const submissions = data?.rows ?? EMPTY_ROWS;
  const total = data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  const handlePaginationChange: OnChangeFn<PaginationState> = (updater) => {
    const next = typeof updater === 'function' ? updater({ pageIndex, pageSize }) : updater;
    setPageIndex(next.pageIndex);
    setPageSize(next.pageSize);
  };

  // Sorting is server-side; changing it resets to the first page.
  const handleSortingChange: OnChangeFn<SortingState> = (updater) => {
    const next = typeof updater === 'function' ? updater(sorting) : updater;
    setSorting(next);
    setPageIndex(0);
  };

  // A filter change resets to the first page (the result set shifts under you).
  const onFilter = (setter: (v: string[]) => void) => (v: string[]) => {
    setter(v);
    setPageIndex(0);
  };

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
    // The type rides along on the row, so it is right even for a problem the picker has
    // never loaded.
    setViewerProblemType(submission.problemType);
    setJffViewerOpen(true);
  };

  const handleDownloadSubmission = (submission: SubmissionItem) => {
    if (!submission.fileName) return;

    const url = apiPaths.files.submission(encodeURIComponent(submission.fileName), {
      download: true,
    });
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

  const handleClearFilters = () => {
    setSelectedCourses([]);
    setSelectedAssignments([]);
    setSelectedProblems([]);
    setTiming([]);
    setStatusFilter([]);
    setSearchInput('');
    setPageIndex(0);
  };

  const anyFilterActive =
    selectedCourses.length > 0 ||
    selectedAssignments.length > 0 ||
    selectedProblems.length > 0 ||
    timing.length > 0 ||
    statusFilter.length > 0 ||
    searchInput.length > 0;

  const handleRerunSubmission = async (submission: SubmissionItem) => {
    await rerunSubmission({
      submission: submission as unknown as Parameters<typeof rerunSubmission>[0]['submission'],
      setRerunning,
      fetchReviewData,
    });
  };

  /**
   * The assignment's due date for a row, or null when it is unparseable.
   *
   * Comes with the row now. It used to be looked up in the loaded assignment list, which
   * held only the current selection, so any row outside it got no due date and was labelled
   * "On time" whatever its timestamp said.
   */
  const dueDateFor = (submission: SubmissionItem): Date | null => {
    const due = submission.dueDate ? new Date(submission.dueDate) : null;
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
        // Next to the timestamp it is a judgement about. The accessor is the chip's own
        // label so the mobile cards read "On time" rather than a code.
        //
        // Not sortable: Timing compares two columns (submittedAt against the assignment's
        // due date) rather than reading one, and the rows on screen are one page of a
        // server-ordered result, so a client sort here would only reorder the page and
        // claim to have ordered the whole queue. Filter by it instead.
        enableSorting: false,
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
        meta: { priority: 2 },
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
        id: 'assignmentType',
        header: 'Type',
        // Whether the work was handed in as a group, which decides whether one submission
        // stands for several students.
        accessorFn: (s) => (s.isGroupAssignment ? 'Group' : 'Individual'),
        enableSorting: false,
        cell: ({ row }) => (
          <Badge
            variant="outline"
            className={`gap-1.5 text-xs font-normal ${
              row.original.isGroupAssignment
                ? 'bg-status-warning-bg border-status-warning-border text-status-warning'
                : 'bg-status-info-bg border-status-info-border text-status-info'
            }`}
          >
            {row.original.isGroupAssignment ? (
              <Users className="h-3.5 w-3.5" aria-hidden="true" />
            ) : (
              <User className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            {row.original.isGroupAssignment ? 'Group' : 'Individual'}
          </Badge>
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
        /*
         * The submitted file, laid out the way a course page lists a problem's solution:
         * the name opens the viewer, the icon beside it downloads. Both actions are also
         * in the row's Manage menu; having them on the file itself saves opening the menu
         * when working down a queue, which is most of what this page is for.
         */
        id: 'file',
        header: 'File',
        accessorFn: (s) => s.originalFileName ?? s.fileName ?? '',
        cell: ({ row }) => {
          const submission = row.original;
          // fileName is what the server stores it under; originalFileName is what the
          // student called it. Without the stored name there is nothing to fetch.
          const name = submission.originalFileName || submission.fileName;
          if (!submission.fileName || !name) {
            return <span className="text-muted-foreground text-sm">-</span>;
          }
          // Name left, download pinned right: the icons line up down the column without
          // right-aligning the names, which read badly ragged when file names differ in
          // length. `w-full` is what lets justify-between reach the column edge.
          return (
            <div className="flex w-full items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => handleViewSubmission(submission)}
                className="text-primary text-xs break-all hover:underline"
                title={`View ${name}`}
              >
                {name}
              </button>
              <a
                href={apiPaths.files.submission(encodeURIComponent(submission.fileName), {
                  download: true,
                })}
                download={name}
                title={`Download ${name}`}
                aria-label={`Download ${name}`}
                className="text-muted-foreground hover:text-foreground shrink-0"
              >
                <Download className="h-4 w-4" aria-hidden="true" />
              </a>
            </div>
          );
        },
        meta: { priority: 3 },
      },
      {
        id: 'due',
        header: 'Due',
        accessorFn: (s) => dueDateFor(s)?.getTime() ?? 0,
        cell: ({ row }) => <CompactDate value={dueDateFor(row.original)} timeZone={timezone} />,
        meta: { priority: 3 },
      },
      {
        /*
         * What THIS attempt earned, not what the student ends up with. The autograder
         * scores an attempt all-or-nothing (correct earns the problem's points, incorrect
         * earns zero), and nothing per-submission is stored, so it is derived from the
         * row's own result. A row still waiting, processing or failed has no result yet
         * and shows a dash rather than a misleading zero.
         *
         * This is the column that differs per row. The recorded grade below is one value
         * per student and problem, so it repeats down every attempt.
         */
        id: 'attemptGrade',
        header: 'Grade',
        // Not sortable: it is derived from `correct` and the problem's points rather than
        // stored, so the server has no column to order the whole queue by.
        enableSorting: false,
        accessorFn: (s) => attemptPointsFor(s) ?? -1,
        cell: ({ row }) => {
          const points = attemptPointsFor(row.original);
          const { maxPoints } = row.original;
          const text =
            points == null ? '-' : maxPoints != null ? `${points} / ${maxPoints}` : String(points);
          return <span className="text-foreground text-sm whitespace-nowrap">{text}</span>;
        },
        meta: { priority: 2 },
      },
      {
        // The student's standing grade for the problem, from AssignmentProblemGrade. Off by
        // default because it is the same number on every one of that student's attempts;
        // it is worth turning on to spot a hand-entered grade that the latest attempt does
        // not explain.
        id: 'grade',
        header: 'Recorded grade',
        // Not sortable: it lives in AssignmentProblemGrade, which Submission has no relation
        // to, so it is joined per page rather than ordered by.
        enableSorting: false,
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
        meta: { priority: 3 },
      },
      {
        id: 'status',
        header: 'Status',
        /*
         * The grading result, next to the grade it explains. The accessor is the chip's own
         * label so the mobile cards read words rather than codes.
         *
         * Sorting is server-side and orders by the stored queue state and then `correct`,
         * which is not the alphabetical order of the badge text. It is the order the data
         * actually has; the five labels are two columns wearing one badge.
         *
         * The filter for this column, and Timing's, now live in the toolbar's Filters menu
         * rather than on the column: the table shows one server-ordered page, so a
         * client-side faceted filter could only ever narrow the rows already on screen.
         */
        accessorFn: (s) =>
          s.autograderEnabled
            ? getReviewStatusChip(s as ProblemSubmission).label
            : 'Not autograded',
        cell: ({ row }) => (
          row.original.autograderEnabled ? (
            <StatusBadge chip={getReviewStatusChip(row.original as ProblemSubmission)} />
          ) : (
            <StatusBadge
              chip={{
                // Not "Manually graded": this column is the evaluator's verdict, and a
                // hand-graded problem may have no grade at all. It also has to stay clear of
                // the grade-source wording, where "Manual" means a person entered the grade.
                label: 'Not autograded',
                variant: 'neutral',
                title: 'The autograder is switched off for this problem.',
              }}
            />
          )
        ),
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
    // The cells no longer read the picker lists: a row carries its own due date and problem
    // type, so `assignments` and `problems` are gone from here and the columns stop being
    // rebuilt every time a filter list loads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [timezone],
  );

  return (
    <Card className="p-4">
      <CardHeader className="pb-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <CardTitle role="heading" aria-level={1} className="text-2xl">
              Submissions
            </CardTitle>
          </div>
          {/* No bulk rerun here. It re-ran whatever the page's own selection held, which
              stopped matching what the table showed once status filtering moved into the
              table, so the button could not honestly describe what it was about to do.
              Rerunning one submission lives in its row's Manage menu. */}
        </div>

        {/* No "Select All" any more. An empty picker now means every course, assignment and
            problem, so selecting all of them would have been the same view by a longer
            route, and it was the thing that made the page enumerate every id on load. */}
        <div className="mt-3 flex gap-2">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={handleClearFilters}
            disabled={!anyFilterActive}
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
          {/* Each picker reads "All ..." while empty, because empty is not "nothing
              selected, so nothing shown" here: it is the unfiltered view the page opens on. */}
          <SearchableMultiSelect
            label="Course filter"
            items={courseOptions}
            value={selectedCourses}
            onChange={onFilter(setSelectedCourses)}
            placeholder={loadingCourses ? 'Loading courses…' : 'All courses'}
            searchPlaceholder="Search courses"
            emptyStateText={loadingCourses ? 'Loading courses…' : 'No courses found.'}
            disabled={loadingCourses}
          />
          <SearchableMultiSelect
            label="Assignment filter"
            items={assignmentOptions}
            value={selectedAssignments}
            onChange={onFilter(setSelectedAssignments)}
            placeholder={loadingAssignments ? 'Loading assignments…' : 'All assignments'}
            searchPlaceholder="Search assignments"
            emptyStateText={loadingAssignments ? 'Loading assignments…' : 'No assignments found.'}
            disabled={loadingAssignments || selectedCourses.length === 0}
          />
          <SearchableMultiSelect
            label="Problem filter"
            items={problemOptions}
            value={selectedProblems}
            onChange={onFilter(setSelectedProblems)}
            placeholder={loadingProblems ? 'Loading problems…' : 'All problems'}
            searchPlaceholder="Search problems"
            emptyStateText={loadingProblems ? 'Loading problems…' : 'No problems found.'}
            disabled={loadingProblems || selectedAssignments.length === 0}
          />
        </div>

        <DataTable
          columns={columns}
          data={submissions}
          loading={loadingSubmissions}
          loadingMessage="Loading submissions, please wait..."
          // Suffixed each time the column set changes: a saved layout wins over these
          // defaults, so a browser holding the old one would keep showing the recorded
          // grade in place of the per-attempt one.
          storageKey="autograder-columns-v3"
          tableLabel="Submissions"
          // The browser holds one page, so an export from here would silently write that
          // page and call it the table. Dropped rather than left to mislead, matching the
          // other server-paginated tables.
          showExportButton={false}
          // Due is off by default: the deadline matters far less than arrival order when
          // you are working a queue, and the Timing column already flags late work.
          // Recorded grade is off because it repeats the same number down every attempt
          // by one student; the Grade column shows what each attempt itself earned. The
          // Columns menu turns either back on, remembered per browser.
          defaultColumnVisibility={{ due: false, grade: false }}
          emptyIcon={FileCode2}
          {...(anyFilterActive
            ? {
                // Distinguish "nothing has been submitted" from "your filters hide
                // everything": the fix for the second is a filter change, not more work.
                emptyTitle: 'No submissions match your filters',
                emptyDescription: 'Try clearing a course, assignment, problem or status filter.',
              }
            : {
                emptyTitle: 'No submissions yet',
                emptyDescription: 'Work submitted for a problem will show up here.',
              })}
          actionButtons={
            <DataTableFilterMenu
              groups={[
                {
                  key: 'timing',
                  label: 'Timing',
                  options: [
                    { label: 'On time', value: 'ontime' },
                    { label: 'Late', value: 'late' },
                  ],
                  selected: timing,
                  onChange: onFilter(setTiming),
                },
                {
                  /*
                   * One group, shown as two headings. Where a submission has got to
                   * (Pending / Processing / Failed) and how it turned out (Correct /
                   * Incorrect) are different questions, so they get their own lists. They
                   * stay one group because a row has exactly one of these five values: as
                   * two groups the server would AND them, and any cross-heading pick (say
                   * Failed plus Correct) could only ever return nothing. Sharing the group
                   * keeps that pick meaning "either".
                   *
                   * Timing IS its own group, because timing and result are independent and
                   * should AND: Late plus Incorrect finds late wrong answers.
                   */
                  key: 'status',
                  label: 'Status',
                  sections: [
                    {
                      label: 'Status',
                      options: [
                        { label: 'Pending', value: 'pending' },
                        { label: 'Processing', value: 'processing' },
                        { label: 'Failed', value: 'failed' },
                      ],
                    },
                    {
                      label: 'Submission',
                      options: [
                        { label: 'Correct', value: 'correct' },
                        { label: 'Incorrect', value: 'incorrect' },
                      ],
                    },
                  ],
                  selected: statusFilter,
                  onChange: onFilter(setStatusFilter),
                },
              ]}
            />
          }
          manualPagination
          pageCount={pageCount}
          rowCount={total}
          pagination={{ pageIndex, pageSize }}
          onPaginationChange={handlePaginationChange}
          manualFiltering
          globalFilter={searchInput}
          onGlobalFilterChange={setSearchInput}
          searchScopeOptions={SEARCH_FIELDS}
          searchScope={searchField}
          onSearchScopeChange={(v) => {
            setSearchField(v);
            setPageIndex(0);
          }}
          manualSorting
          sorting={sorting}
          onSortingChange={handleSortingChange}
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
