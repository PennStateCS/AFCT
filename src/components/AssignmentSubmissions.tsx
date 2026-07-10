'use client';

import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
import { FileText } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { Submission, User } from '@prisma/client';
import { showToast } from '@/lib/toast';
import { apiPaths } from '@/lib/api-paths';
import { queryKeys } from '@/lib/query-keys';
import { rerunSubmission } from '@/app/utils/rerunSubmission';
import { rerunVisibleSubmissions } from '@/app/utils/rerunVisibleSubmissions';
import type { Comment as DiscussionComment } from './DiscussionPanel';
import { ProblemListCard } from '@/components/assignments/ProblemListCard';
import ProblemWorkspace from '@/components/assignments/ProblemWorkspace';
import type { ProblemSubmission } from '@/lib/problem-submission';
import StudentNavigator from './StudentNavigator';
import JffViewerDialog from './JffViewerDialog';
import { useEmptyStringSymbol } from '@/lib/useEmptyStringSymbol';
import { RegexViewerDialog } from '@/components/dialogs/RegexViewerDialog';
import { CfgViewerDialog } from '@/components/dialogs/CfgViewerDialog';

type Person = Pick<User, 'firstName' | 'lastName' | 'id'>;

type Problem = {
  id: string;
  title: string;
  description?: string;
  type?: string;
  maxPoints?: number;
  maxStates?: number;
  isDeterministic?: boolean;
  fileName?: string;
  originalFileName?: string;
  maxSubmissions?: number;
  autograderEnabled?: boolean;
};

type SubmissionData = Submission[] | { submissions: Submission[] };

type Props = {
  courseIsArchived: boolean;
  courseId: string;
  assignmentId: string;
  maxAssignmentGrade: number;
  assignmentDueDate?: string | Date | null;
  problems?: Problem[];
  assignmentIsGroup?: boolean;
  groups?: { id: string; name: string }[];
  groupProblemsMap?: Record<string, string[]>;
};

// Helpers
const hasSubmissions = (obj: unknown): obj is { submissions: Submission[] } => {
  return (
    !!obj &&
    typeof obj === 'object' &&
    Array.isArray((obj as { submissions?: unknown }).submissions)
  );
};

const extractSubs = (raw?: SubmissionData): Submission[] => {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;

  // TypeScript now automatically knows 'raw' has the submissions array
  if (hasSubmissions(raw)) {
    return raw.submissions;
  }

  return [];
};

export default function AssignmentSubmissions({
  courseIsArchived,
  courseId,
  assignmentId,
  assignmentDueDate,
  problems,
  assignmentIsGroup = false,
  groups = [],
  groupProblemsMap = {},
}: Props) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const epsSymbol = useEmptyStringSymbol(courseId);
  const searchParams = useSearchParams();
  const searchParamsString = searchParams.toString();
  const selectedStudentIdParam = searchParams.get('studentId');
  const [selectedIndex, setSelectedIndex] = useState<number>(-1);
  const [submissions, setSubmissions] = useState<Record<string, SubmissionData>>({});
  const [comments, setComments] = useState<Record<string, DiscussionComment[]>>({});
  const [commentTexts, setCommentTexts] = useState<Record<string, string>>({});
  const [savingComments, setSavingComments] = useState<Record<string, boolean>>({});
  const [deletingComments, setDeletingComments] = useState<Record<string, boolean>>({});
  const [rerunning, setRerunning] = useState<Record<string, boolean>>({});
  const [selectedProblemId, setSelectedProblemId] = useState<string | null>(null);
  // If this is a group assignment we'll compute the student's group and
  // filter which problems are shown. Cache per-student group lookups.
  // undefined = not yet resolved; null = resolved -> student is not in any group
  const [selectedStudentGroupId, setSelectedStudentGroupId] = useState<string | null | undefined>(
    undefined,
  );

  // Grade editing state (robust, GradesCard style)
  const [problemGrades, setProblemGrades] = useState<Record<string, number | null>>({});
  const [gradeInputs, setGradeInputs] = useState<Record<string, string>>({});
  const [problemGradeErrors, setProblemGradeErrors] = useState<Record<string, string | null>>({});
  const [savingProblemGrades, setSavingProblemGrades] = useState<Record<string, boolean>>({});
  const [showStudentDataLoading, setShowStudentDataLoading] = useState(false);
  const [studentGradeStatuses, setStudentGradeStatuses] = useState<Record<string, boolean>>({});
  const [openDialog, setOpenDialog] = useState<{
    open: boolean;
    submission: Submission | ProblemSubmission | null;
  }>({ open: false, submission: null });

  // Students — cached read shared with GroupsCard via the same query key.
  const studentsQuery = useQuery({
    queryKey: ['course', courseId, 'students'],
    queryFn: async () => {
      const res = await fetch(apiPaths.courseStudents(courseId));
      if (!res.ok) throw new Error((await res.json())?.error || 'Failed to load students');
      return (await res.json()) as Person[];
    },
    staleTime: 30_000,
  });

  // Derived, sorted students list (replaces the old `students` useState). Sort
  // alphabetically by last name, then first name (case-insensitive).
  const students = useMemo<Person[]>(() => {
    return [...(studentsQuery.data ?? [])].sort((a, b) => {
      const aLast = (a.lastName ?? '').toLowerCase();
      const bLast = (b.lastName ?? '').toLowerCase();
      if (aLast < bLast) return -1;
      if (aLast > bLast) return 1;
      const aFirst = (a.firstName ?? '').toLowerCase();
      const bFirst = (b.firstName ?? '').toLowerCase();
      if (aFirst < bFirst) return -1;
      if (aFirst > bFirst) return 1;
      return 0;
    });
  }, [studentsQuery.data]);

  // Surface a load failure the same way the imperative catch did.
  const studentsQueryIsError = studentsQuery.isError;
  useEffect(() => {
    if (studentsQueryIsError) {
      console.error('Fetch students error:', studentsQuery.error);
      showToast.error('Failed to load students');
    }
  }, [studentsQueryIsError, studentsQuery.error]);

  const updateQuery = useCallback(
    (problemId: string) => {
      const params = new URLSearchParams(searchParamsString);
      params.set('problemId', problemId);
      router.replace(`?${params.toString()}`, { scroll: false });
    },
    [router, searchParamsString],
  );

  const updateStudentQuery = useCallback(
    (studentId: string) => {
      const params = new URLSearchParams(searchParamsString);
      params.set('studentId', studentId);
      router.replace(`?${params.toString()}`, { scroll: false });
    },
    [router, searchParamsString],
  );

  // Build the assignment-specific problem list from assignment payload.
  const assignmentProblems = useMemo(() => {
    return problems ?? [];
  }, [problems]);

  // Compute which problems should be visible for the selected student when
  // this is a group assignment. Rules:
  // - Problems mapped to the student's group are visible
  // - Problems not mapped to any group (assignment-level) are visible to all
  // - If group mapping isn't available yet, fall back to showing all problems
  const visibleProblems = useMemo(() => {
    // If this is not a group assignment, show all assignment problems
    if (!assignmentIsGroup) return assignmentProblems;

    const gpMap = groupProblemsMap ?? {};
    const allMapped = new Set<string>(Object.values(gpMap).flat());

    // Assignment-level problems = problems not mapped to any group
    const assignmentLevel = assignmentProblems.filter((p) => !allMapped.has(p.id));

    // If mappings not loaded yet -> fall back to showing all assignment problems
    if (!gpMap || Object.keys(gpMap).length === 0) return assignmentProblems;

    // If we don't yet know the student's group (undefined), show assignment-level + all group-mapped (safe fallback)
    if (selectedStudentGroupId === undefined) {
      const byGroup = new Set<string>([
        ...assignmentLevel.map((p) => p.id),
        ...Object.values(gpMap).flat(),
      ]);
      return assignmentProblems.filter((p) => byGroup.has(p.id));
    }

    // If the student is resolved to be NOT in any group (null), show only assignment-level problems
    if (selectedStudentGroupId === null) {
      return assignmentLevel;
    }

    // Visible = assignment-level + problems mapped to the student's group
    const allowed = new Set<string>(assignmentLevel.map((p) => p.id));
    for (const pid of gpMap[selectedStudentGroupId] ?? []) allowed.add(pid);
    return assignmentProblems.filter((p) => allowed.has(p.id));
  }, [assignmentProblems, selectedStudentGroupId, groupProblemsMap, assignmentIsGroup]);

  const limitText = useCallback((value: string, max = 80) => {
    return value.length > max ? `${value.slice(0, max - 1)}…` : value;
  }, []);

  const problemListItems = useMemo(
    () =>
      visibleProblems.map((problem, index) => ({
        id: problem.id,
        title: problem.title ? limitText(problem.title, 25) : `Problem ${index + 1}`,
        grade: problemGrades[problem.id] ?? null,
        maxGrade: problem.maxPoints ?? null,
        submissionsCount: extractSubs(submissions[problem.id]).length,
        maxSubmissions: problem.maxSubmissions ?? null,
      })),
    [visibleProblems, limitText, problemGrades, submissions],
  );

  // Initialize selected problem from the URL, but only from the set of
  // currently visible problems (handles group assignment filtering).
  useEffect(() => {
    if (visibleProblems.length === 0) return;
    const params = new URLSearchParams(searchParamsString);
    const paramProblemId = params.get('problemId');
    const firstProblem = visibleProblems[0];
    if (!firstProblem) return;
    const validProblemId = visibleProblems.some((p) => p.id === paramProblemId)
      ? (paramProblemId as string)
      : firstProblem.id;

    setSelectedProblemId((currentProblemId) =>
      currentProblemId === validProblemId ? currentProblemId : validProblemId,
    );
    if (paramProblemId !== validProblemId) {
      updateQuery(validProblemId);
    }
  }, [visibleProblems, searchParamsString, updateQuery]);

  const selectedStudent = students[selectedIndex] ?? null;
  const selectedStudentId = selectedStudent?.id ?? null;

  const assignmentTotals = useMemo(() => {
    if (!selectedStudent) return null;

    const totalEarned = assignmentProblems.reduce((sum, problem) => {
      const gradeValue = problemGrades[problem.id];
      const safeGrade =
        typeof gradeValue === 'number' && Number.isFinite(gradeValue) ? Math.max(0, gradeValue) : 0;
      return sum + safeGrade;
    }, 0);

    const hasUnlimited = assignmentProblems.some(
      (problem) => typeof problem.maxPoints === 'number' && problem.maxPoints < 0,
    );

    const totalAvailable = hasUnlimited
      ? Number.POSITIVE_INFINITY
      : assignmentProblems.reduce((sum, problem) => {
          const max =
            typeof problem.maxPoints === 'number' && Number.isFinite(problem.maxPoints)
              ? Math.max(0, problem.maxPoints)
              : 0;
          return sum + max;
        }, 0);

    return { earned: totalEarned, available: totalAvailable };
  }, [assignmentProblems, problemGrades, selectedStudent]);

  // Preload group membership once per course to avoid repeated network calls when
  // navigating between students. A single consolidated endpoint returns every
  // (userId, groupId) pair for the course.
  const groupMembershipsQuery = useQuery({
    queryKey: ['course', courseId, 'group-memberships'],
    queryFn: async () => {
      const res = await fetch(apiPaths.courseGroupMemberships(courseId));
      if (!res.ok) throw new Error('Failed to load group memberships');
      return (await res.json()) as { memberships: Array<{ userId: string; groupId: string }> };
    },
    enabled: assignmentIsGroup && groups.length > 0,
    staleTime: 30_000,
  });

  // Cold-load only: on a warm cache a background refetch of memberships must not
  // blank the student panel or reset the resolved group (isFetching would).
  const loadingGroupMemberships = groupMembershipsQuery.isLoading;

  // Build the userId→groupId map by iterating groups IN ORDER and assigning the
  // consolidated memberships that match each group, first-write-wins per user —
  // this preserves the exact "first group in array order wins" semantics of the
  // previous per-group fan-out. Empty when not a group assignment / no data.
  const groupMembershipByStudent = useMemo<Record<string, string>>(() => {
    if (!assignmentIsGroup || !groups || groups.length === 0) return {};
    const memberships = groupMembershipsQuery.data?.memberships;
    if (!memberships) return {};
    const membershipMap: Record<string, string> = {};
    for (const group of groups) {
      for (const member of memberships) {
        if (member.groupId !== group.id) continue;
        if (!membershipMap[member.userId]) {
          membershipMap[member.userId] = group.id;
        }
      }
    }
    return membershipMap;
  }, [assignmentIsGroup, groups, groupMembershipsQuery.data]);

  // Determine selected student's group from preloaded membership data.
  useEffect(() => {
    if (!assignmentIsGroup || !selectedStudent) {
      setSelectedStudentGroupId(null);
      return;
    }

    if (loadingGroupMemberships) {
      setSelectedStudentGroupId(undefined);
      return;
    }

    const groupId = groupMembershipByStudent[selectedStudent.id] ?? null;
    setSelectedStudentGroupId(groupId);
  }, [assignmentIsGroup, selectedStudent, loadingGroupMemberships, groupMembershipByStudent]);

  const handleSelectProblem = useCallback(
    (problemId: string) => {
      setSelectedProblemId(problemId);
      updateQuery(problemId);
    },
    [updateQuery],
  );

  useEffect(() => {
    if (students.length === 0) {
      setSelectedIndex(-1);
      return;
    }

    const nextIndex = selectedStudentIdParam
      ? students.findIndex((student) => student.id === selectedStudentIdParam)
      : -1;

    const resolvedIndex = nextIndex !== -1 ? nextIndex : 0;
    setSelectedIndex((currentIndex) =>
      currentIndex === resolvedIndex ? currentIndex : resolvedIndex,
    );
  }, [students, selectedStudentIdParam]);

  useEffect(() => {
    if (!selectedStudent) return;
    if (selectedStudentIdParam !== selectedStudent.id) {
      updateStudentQuery(selectedStudent.id);
    }
  }, [selectedStudentIdParam, selectedStudent, updateStudentQuery]);

  // Grade summary — cached read of which students have all problems graded.
  const gradeSummaryQuery = useQuery({
    queryKey: ['course', courseId, 'assignment', assignmentId, 'problem-grades', 'summary'],
    queryFn: async () => {
      const res = await fetch(apiPaths.assignmentProblemGradesSummary(courseId, assignmentId));
      if (!res.ok) {
        // Match the previous silent handling of auth/not-found responses.
        if ([401, 403, 404].includes(res.status)) return {} as Record<string, boolean>;
        throw new Error((await res.json())?.error || 'Failed to load grade summary');
      }
      return ((await res.json()) ?? {}) as Record<string, boolean>;
    },
    enabled: students.length > 0,
    staleTime: 30_000,
  });

  const gradeSummaryQueryIsError = gradeSummaryQuery.isError;
  useEffect(() => {
    if (gradeSummaryQueryIsError) {
      console.error('Failed to load grade summary:', gradeSummaryQuery.error);
    }
  }, [gradeSummaryQueryIsError, gradeSummaryQuery.error]);

  // Seed the base studentGradeStatuses from the summary, normalized over students
  // exactly as the previous effect did. This local state is also updated by grade
  // saves and review-data seeding, so we do NOT invalidate the summary on save.
  const gradeSummaryData = gradeSummaryQuery.data;
  useEffect(() => {
    if (students.length === 0) {
      setStudentGradeStatuses({});
      return;
    }
    if (gradeSummaryData === undefined) return;
    const normalized: Record<string, boolean> = {};
    students.forEach((student) => {
      normalized[student.id] = Boolean(gradeSummaryData?.[student.id]);
    });
    setStudentGradeStatuses(normalized);
  }, [students, gradeSummaryData]);

  // Review data (submissions + comments + problem grades) for the selected student.
  // TanStack Query owns the fetch, cancellation (via signal), and dedupe — the old
  // AbortController / request-sequence plumbing is gone.
  type ReviewDataResponse = {
    submissions?: Record<string, SubmissionData>;
    comments?: Array<DiscussionComment & { problemId?: string | null }>;
    problemGrades?: Record<string, { grade: number | null; feedback: string | null }>;
  };

  const reviewQuery = useQuery({
    queryKey: queryKeys.assignment.reviewData(courseId, assignmentId, selectedStudentId ?? ''),
    queryFn: async ({ signal }): Promise<ReviewDataResponse> => {
      const res = await fetch(
        apiPaths.assignmentReviewData(courseId, assignmentId, selectedStudentId ?? ''),
        { signal },
      );
      if (!res.ok) {
        // Match the previous silent handling of auth/not-found responses.
        if ([401, 403, 404].includes(res.status)) {
          return { submissions: {}, comments: [], problemGrades: {} };
        }
        throw new Error((await res.json())?.error || 'Failed to load review data');
      }
      return ((await res.json()) ?? {}) as ReviewDataResponse;
    },
    enabled: !!selectedStudentId,
    staleTime: 30_000,
  });

  // Stable refresher used by the rerun helpers (they previously took fetchReviewData).
  const refreshReview = useCallback(async () => {
    await queryClient.invalidateQueries({
      queryKey: queryKeys.assignment.reviewData(courseId, assignmentId, selectedStudentId ?? ''),
    });
  }, [queryClient, courseId, assignmentId, selectedStudentId]);

  // All three loading flags previously flipped together; derive them from the query.
  // isPending (not isFetching) so the spinner shows only on the cold load of a
  // student's data. After a grade/comment save invalidates review-data, the
  // background refetch must NOT blank the whole workspace back to a spinner.
  const reviewFetching = !!selectedStudentId && reviewQuery.isPending;
  const loadingSubmissions = reviewFetching;
  const loadingComments = reviewFetching;
  const loadingProblemGrades = reviewFetching;

  // Seed the local editable state from the cached review data. This carries the
  // EXACT seeding logic from the old fetchReviewData success block. When there is
  // no selected student, clear the local state (the old null-branch behavior).
  const reviewData = reviewQuery.data;
  const reviewQueryIsError = reviewQuery.isError;
  useEffect(() => {
    if (!selectedStudentId) {
      setSubmissions({});
      setComments({});
      setProblemGrades({});
      setGradeInputs({});
      setProblemGradeErrors({});
      return;
    }

    if (reviewQueryIsError) {
      console.error('Fetch review data error:', reviewQuery.error);
      showToast.error('Failed to load review data');
      setSubmissions({});
      setComments({});
      setProblemGrades({});
      setGradeInputs({});
      return;
    }

    if (reviewData === undefined) return;

    setSubmissions(reviewData.submissions || {});

    const groupedComments = Object.fromEntries(
      assignmentProblems.map((problem) => [problem.id, [] as DiscussionComment[]]),
    ) as Record<string, DiscussionComment[]>;

    for (const comment of reviewData.comments ?? []) {
      const problemId = comment.problemId;
      if (problemId && groupedComments[problemId]) {
        groupedComments[problemId].push(comment);
      }
    }
    setComments(groupedComments);

    const gradeData = reviewData.problemGrades ?? {};
    const normalizedGrades: Record<string, number | null> = {};
    const normalizedInputs: Record<string, string> = {};
    assignmentProblems.forEach((problem) => {
      const entry = gradeData?.[problem.id];
      const value = typeof entry?.grade === 'number' ? entry.grade : null;
      normalizedGrades[problem.id] = value;
      normalizedInputs[problem.id] = value === null || value === undefined ? '' : String(value);
    });

    setProblemGrades(normalizedGrades);
    setGradeInputs(normalizedInputs);
    setProblemGradeErrors({});

    const hasAllGrades =
      assignmentProblems.length === 0
        ? true
        : assignmentProblems.every((problem) => {
            const value = normalizedGrades[problem.id];
            return value !== null && value !== undefined;
          });
    setStudentGradeStatuses((prev) => ({
      ...prev,
      [selectedStudentId]: hasAllGrades,
    }));
  }, [selectedStudentId, reviewData, reviewQueryIsError, reviewQuery.error, assignmentProblems]);

  const handleRerunSubmission = useCallback(
    async (submission: Submission) => {
      await rerunSubmission({ submission, setRerunning, fetchReviewData: refreshReview });
    },
    [refreshReview],
  );

  const handleRerunVisibleSubmissions = useCallback(
    async (visibleSubmissions: ProblemSubmission[]) => {
      await rerunVisibleSubmissions({
        visibleSubmissions,
        setRerunning,
        fetchReviewData: refreshReview,
      });
    },
    [refreshReview],
  );

  const saveComment = useCallback(
    async (problemId: string) => {
      const commentText = commentTexts[problemId]?.trim();
      if (!commentText || !selectedStudent) return;

      setSavingComments((prev) => ({ ...prev, [problemId]: true }));
      try {
        const response = await fetch(apiPaths.comments(), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            content: commentText,
            assignmentId,
            problemId,
            studentId: selectedStudent.id,
          }),
        });
        if (!response.ok) {
          const error = await response.json().catch(() => ({}));
          throw new Error(error?.error || 'Failed to save comment');
        }
        const newComment = await response.json();
        setComments((prev) => ({
          ...prev,
          [problemId]: [...(prev[problemId] || []), newComment],
        }));
        setCommentTexts((prev) => ({ ...prev, [problemId]: '' }));
        // Keep the cached review data fresh after the optimistic local update.
        queryClient.invalidateQueries({
          queryKey: [
            'course',
            courseId,
            'assignment',
            assignmentId,
            'review-data',
            selectedStudentId,
          ],
        });
        showToast.success('Comment saved successfully');
      } catch (err) {
        console.error('Save comment error:', err);
        showToast.error(err instanceof Error ? err.message : 'Failed to save comment');
      } finally {
        setSavingComments((prev) => ({ ...prev, [problemId]: false }));
      }
    },
    [commentTexts, selectedStudent, assignmentId, courseId, selectedStudentId, queryClient],
  );

  const deleteComment = useCallback(
    async (commentId: string, problemId: string) => {
      setDeletingComments((prev) => ({ ...prev, [commentId]: true }));
      try {
        const response = await fetch(apiPaths.comments({ commentId }), {
          method: 'DELETE',
        });
        if (!response.ok) {
          const error = await response.json().catch(() => ({}));
          throw new Error(error?.error || 'Failed to delete comment');
        }
        setComments((prev) => ({
          ...prev,
          [problemId]: prev[problemId]?.filter((c) => c.id !== commentId) || [],
        }));
        // Keep the cached review data fresh after the optimistic local update.
        queryClient.invalidateQueries({
          queryKey: [
            'course',
            courseId,
            'assignment',
            assignmentId,
            'review-data',
            selectedStudentId,
          ],
        });
        showToast.success('Comment deleted successfully');
      } catch (err) {
        console.error('Delete comment error:', err);
        showToast.error(err instanceof Error ? err.message : 'Failed to delete comment');
      } finally {
        setDeletingComments((prev) => ({ ...prev, [commentId]: false }));
      }
    },
    [courseId, assignmentId, selectedStudentId, queryClient],
  );

  const handleGradeInputChange = useCallback((problemId: string, value: string) => {
    setGradeInputs((prev) => ({ ...prev, [problemId]: value }));
    setProblemGradeErrors((prev) => ({ ...prev, [problemId]: null }));
  }, []);

  const saveProblemGrade = useCallback(
    async (problemId: string) => {
      if (!selectedStudent) return;
      if (courseIsArchived) {
        showToast.error('Course is archived; grades cannot be edited.');
        return;
      }

      const problem = assignmentProblems.find((p) => p.id === problemId);
      if (!problem) return;
      const rawMaxPoints = typeof problem.maxPoints === 'number' ? problem.maxPoints : null;
      const hasUpperBound = typeof rawMaxPoints === 'number' && rawMaxPoints >= 0;
      const rawValue = gradeInputs[problemId] ?? '';
      const trimmed = rawValue.trim();
      const numericValue = trimmed === '' ? null : Number(trimmed);

      if (numericValue !== null) {
        if (Number.isNaN(numericValue)) {
          setProblemGradeErrors((prev) => ({ ...prev, [problemId]: 'Grade must be a number' }));
          showToast.error('Grade must be a number');
          return;
        }
        if (numericValue < 0) {
          const message = 'Grade must be at least 0';
          setProblemGradeErrors((prev) => ({ ...prev, [problemId]: message }));
          showToast.error(message);
          return;
        }
        if (hasUpperBound && rawMaxPoints !== null && numericValue > rawMaxPoints) {
          const message = `Grade must be between 0 and ${rawMaxPoints}`;
          setProblemGradeErrors((prev) => ({ ...prev, [problemId]: message }));
          showToast.error(message);
          return;
        }
      }

      setProblemGradeErrors((prev) => ({ ...prev, [problemId]: null }));
      setSavingProblemGrades((prev) => ({ ...prev, [problemId]: true }));

      try {
        const res = await fetch(
          apiPaths.assignmentProblemGrade(courseId, assignmentId, problemId, selectedStudent.id),
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ grade: numericValue }),
          },
        );
        if (!res.ok) {
          const error = await res.json().catch(() => ({}));
          throw new Error(error?.error || 'Failed to save problem grade');
        }

        setProblemGrades((prev) => {
          const updated = { ...prev, [problemId]: numericValue };
          if (selectedStudent) {
            const hasAllGrades =
              assignmentProblems.length === 0
                ? true
                : assignmentProblems.every((problem) => {
                    const value =
                      problem.id === problemId ? numericValue : (prev[problem.id] ?? null);
                    return value !== null && value !== undefined;
                  });
            setStudentGradeStatuses((prevStatus) => ({
              ...prevStatus,
              [selectedStudent.id]: hasAllGrades,
            }));
          }
          return updated;
        });
        setGradeInputs((prev) => ({
          ...prev,
          [problemId]:
            numericValue === null || numericValue === undefined ? '' : String(numericValue),
        }));
        // Keep the cached review data fresh after the optimistic local updates.
        // NOTE: deliberately NOT invalidating the summary query, which would
        // clobber the optimistic studentGradeStatuses update above.
        queryClient.invalidateQueries({
          queryKey: [
            'course',
            courseId,
            'assignment',
            assignmentId,
            'review-data',
            selectedStudent.id,
          ],
        });
        showToast.success(
          `Grade ${numericValue ?? 'cleared'} saved for ${selectedStudent.firstName} ${selectedStudent.lastName} on ${problem.title}`,
        );
      } catch (error) {
        console.error('Save problem grade error:', error);
        const message = error instanceof Error ? error.message : 'Failed to save problem grade';
        setProblemGradeErrors((prev) => ({ ...prev, [problemId]: message }));
        showToast.error(message);
      } finally {
        setSavingProblemGrades((prev) => ({ ...prev, [problemId]: false }));
      }
    },
    [
      assignmentId,
      courseId,
      courseIsArchived,
      gradeInputs,
      assignmentProblems,
      selectedStudent,
      setProblemGrades,
      queryClient,
    ],
  );

  const handleSelectChange = (id: string) => {
    const index = students.findIndex((s) => s.id === id);
    if (index !== -1) setSelectedIndex(index);
  };

  const goPrev = () =>
    setSelectedIndex((prev) => {
      if (students.length === 0) return -1;
      const nextIndex = prev <= 0 ? students.length - 1 : prev - 1;
      return nextIndex;
    });
  const goNext = () =>
    setSelectedIndex((prev) => {
      if (students.length === 0) return -1;
      const nextIndex = prev >= students.length - 1 ? 0 : prev + 1;
      return nextIndex;
    });

  const isStudentDataLoading =
    loadingSubmissions ||
    loadingComments ||
    loadingProblemGrades ||
    (assignmentIsGroup && Boolean(selectedStudent) && selectedStudentGroupId === undefined) ||
    (assignmentIsGroup && loadingGroupMemberships);

  useEffect(() => {
    if (isStudentDataLoading) {
      const timeoutId = setTimeout(() => {
        setShowStudentDataLoading(true);
      }, 150);

      return () => clearTimeout(timeoutId);
    }

    setShowStudentDataLoading(false);
    return undefined;
  }, [isStudentDataLoading]);

  return (
    <div>
      {selectedStudent && (
        <Card className="w-full">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-2xl">
              <FileText className="h-6 w-6" /> Submissions
            </CardTitle>

            <div className="mt-4 flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
              <StudentNavigator
                students={students}
                selectedIndex={selectedIndex}
                onSelectStudent={handleSelectChange}
                onPrev={goPrev}
                onNext={goNext}
                gradeStatuses={studentGradeStatuses}
                assignmentTotals={assignmentTotals ?? undefined}
                courseId={courseId}
                assignmentId={assignmentId}
              />
            </div>
          </CardHeader>

          <CardContent>
            {assignmentProblems.length === 0 ? (
              <div className="text-muted-foreground rounded-md border border-dashed p-6 text-center text-sm">
                No problems have been added to this assignment yet.
              </div>
            ) : showStudentDataLoading ? (
              <div className="flex min-h-[320px] flex-col items-center justify-center gap-3">
                <div className="border-muted-foreground/30 border-t-primary h-8 w-8 animate-spin rounded-full border-4" />
                <p className="text-muted-foreground text-sm">Loading submissions...</p>
              </div>
            ) : (
              (() => {
                const selectedProblem = selectedProblemId
                  ? visibleProblems.find((p) => p.id === selectedProblemId) || null
                  : visibleProblems[0] || null;
                const selectedSubs = selectedProblem
                  ? extractSubs(submissions[selectedProblem.id])
                  : [];
                const selectedComments = selectedProblem ? comments[selectedProblem.id] || [] : [];

                return (
                  <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
                    <ProblemListCard
                      problems={problemListItems}
                      selectedProblemId={selectedProblem?.id ?? null}
                      onSelect={handleSelectProblem}
                      title="Problems"
                      description="Select a problem to review submissions and discussion."
                      className="h-full"
                      scrollAreaClassName="max-h-[520px]"
                    />

                    <div className="print:col-span-2">
                      <ProblemWorkspace
                        problem={selectedProblem}
                        submissions={selectedSubs}
                        assignmentDueDate={assignmentDueDate}
                        comments={selectedComments}
                        commentText={selectedProblem ? commentTexts[selectedProblem.id] || '' : ''}
                        onCommentTextChange={(text: string) =>
                          selectedProblem &&
                          setCommentTexts((prev) => ({
                            ...prev,
                            [selectedProblem.id]: text,
                          }))
                        }
                        onSaveComment={() => selectedProblem && saveComment(selectedProblem.id)}
                        onDeleteComment={(commentId: string) =>
                          selectedProblem && deleteComment(commentId, selectedProblem.id)
                        }
                        isSaving={selectedProblem ? savingComments[selectedProblem.id] : false}
                        deletingComments={deletingComments}
                        onViewSubmission={(submission: ProblemSubmission) =>
                          setOpenDialog({ open: true, submission })
                        }
                        onRerunSubmission={(submission) =>
                          handleRerunSubmission(submission as unknown as Submission)
                        }
                        onRerunVisibleSubmissions={handleRerunVisibleSubmissions}
                        rerunning={rerunning}
                        courseIsArchived={courseIsArchived}
                        gradeInput={selectedProblem ? gradeInputs[selectedProblem.id] || '' : ''}
                        currentGrade={
                          selectedProblem ? (problemGrades[selectedProblem.id] ?? null) : null
                        }
                        gradeError={
                          selectedProblem ? problemGradeErrors[selectedProblem.id] || null : null
                        }
                        onGradeInputChange={(value) =>
                          selectedProblem && handleGradeInputChange(selectedProblem.id, value)
                        }
                        onSaveGrade={() => selectedProblem && saveProblemGrade(selectedProblem.id)}
                        isSavingGrade={
                          selectedProblem ? Boolean(savingProblemGrades[selectedProblem.id]) : false
                        }
                        isLoadingGrade={loadingProblemGrades}
                        isPrivledgedUser={true}
                      />
                    </div>
                  </div>
                );
              })()
            )}
          </CardContent>
        </Card>
      )}

      {openDialog.submission &&
        ['FA', 'PDA', 'TM'].includes(
          visibleProblems.find((p) => p.id === selectedProblemId)?.type ?? '',
        ) && (
          <JffViewerDialog
            open={openDialog.open}
            onOpenChange={(open) => setOpenDialog({ open, submission: null })}
            src={apiPaths.files.submission(
              encodeURIComponent(openDialog.submission.fileName ?? ''),
            )}
            title={`${openDialog.submission.originalFileName || openDialog.submission.fileName} - Submission`}
            width="70vw"
            height="70vh"
            epsSymbol={epsSymbol}
          />
        )}
      {openDialog.submission &&
        (visibleProblems.find((p) => p.id === selectedProblemId)?.type ?? '') === 'RE' && (
          <RegexViewerDialog
            open={openDialog.open}
            onOpenChange={(open) => setOpenDialog({ open, submission: null })}
            src={apiPaths.files.submission(
              encodeURIComponent(openDialog.submission.fileName ?? ''),
            )}
            title={`${openDialog.submission.originalFileName || openDialog.submission.fileName} - Submission`}
          />
        )}
      {openDialog.submission &&
        (visibleProblems.find((p) => p.id === selectedProblemId)?.type ?? '') === 'CFG' && (
          <CfgViewerDialog
            open={openDialog.open}
            onOpenChange={(open) => setOpenDialog({ open, submission: null })}
            src={apiPaths.files.submission(
              encodeURIComponent(openDialog.submission.fileName ?? ''),
            )}
            title={`${openDialog.submission.originalFileName || openDialog.submission.fileName} - Submission`}
          />
        )}
    </div>
  );
}
