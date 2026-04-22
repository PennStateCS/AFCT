'use client';

import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { FileText } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { Submission, User } from '@prisma/client';
import { showToast } from '@/lib/toast';
import type { Comment as DiscussionComment } from './DiscussionPanel';
import { ProblemListCard } from '@/components/assignments/ProblemListCard';
import { ProblemWorkspace } from '@/components/assignments/ProblemWorkspace';
import StudentNavigator from './StudentNavigator';
import JffViewerDialog from './JffViewerDialog';
import SubmissionActionsMenu from './SubmissionActionsMenu';
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
  // When assignmentIsGroup is true the parent will pass `groups` and
  // `groupProblemsMap` so this component can show only the problems
  // assigned to the student's group (unassigned problems apply to all).
  assignmentIsGroup?: boolean;
  groups?: { id: string; name: string }[];
  groupProblemsMap?: Record<string, string[]>;
};

// Helpers
const extractSubs = (raw?: SubmissionData): Submission[] => {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === 'object' && 'submissions' in raw)
    return (raw as { submissions: Submission[] }).submissions;
  return [];
};

function SubmissionTable({
  submissions,
  assignmentDueDate,
  onView,
  onRerun,
  rerunning,
  className = '',
}: {
  submissions: Submission[];
  assignmentDueDate?: string | Date | null;
  onView: (submission: Submission) => void;
  onRerun: (submission: Submission) => void;
  rerunning: Record<string, boolean>;
  className?: string;
}) {
  if (!submissions.length) {
    return (
      <div className="text-muted-foreground rounded-md border border-dashed p-6 text-center text-sm">
        No submissions yet.
      </div>
    );
  }

  const sorted = [...submissions].sort(
    (a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime(),
  );
  const dueDate = assignmentDueDate ? new Date(assignmentDueDate) : null;
  const hasValidDueDate = !!dueDate && !Number.isNaN(dueDate.getTime());

  return (
    <div className={`overflow-hidden rounded-md border ${className}`}>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Submitted</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Feedback</TableHead>
            <TableHead>Action</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.map((s) => {
            const submittedAt = new Date(s.submittedAt);
            const isLate =
              (s as { status?: string }).status === 'LATE' ||
              (hasValidDueDate && submittedAt.getTime() > dueDate!.getTime());
            return (
              <TableRow key={s.id} className="hover:bg-transparent">
                <TableCell>
                  <div className="flex flex-col">
                    <span>{submittedAt.toLocaleDateString()}</span>
                    <span className="text-muted-foreground text-xs">
                      {submittedAt.toLocaleTimeString()}
                    </span>
                    {isLate ? (
                      <Badge
                        variant="secondary"
                        className="mt-1 inline-flex items-center rounded-full bg-amber-100 px-2 py-1 text-[11px] font-semibold text-amber-900 shadow-sm"
                      >
                        Late
                      </Badge>
                    ) : null}
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex justify-center">
                    {s.correct === true ? (
                      <span
                        role="status"
                        aria-label="Correct"
                        title="Correct"
                        className="inline-flex h-3 w-3 rounded-full bg-emerald-500"
                      />
                    ) : s.correct === false ? (
                      <span
                        role="status"
                        aria-label="Needs review"
                        title="Needs review"
                        className="inline-flex h-3 w-3 rounded-full bg-red-500"
                      />
                    ) : (
                      <span
                        role="status"
                        aria-label="Submitted"
                        title="Submitted"
                        className="inline-flex h-3 w-3 rounded-full bg-amber-400"
                      />
                    )}
                  </div>
                </TableCell>
                <TableCell className="break-words whitespace-normal">
                  {s.feedback ? (
                    <span className="text-sm">{s.feedback}</span>
                  ) : (
                    <span className="text-muted-foreground text-sm">No feedback</span>
                  )}
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2 whitespace-nowrap">
                    <SubmissionActionsMenu
                      submission={s}
                      rerunning={Boolean(rerunning[s.id])}
                      onView={onView}
                      onRerun={onRerun}
                    />
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}


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
  const searchParams = useSearchParams();
  const searchParamsString = searchParams.toString();
  const selectedStudentIdParam = searchParams.get('studentId');
  const [students, setStudents] = useState<Person[]>([]);
  const [selectedIndex, setSelectedIndex] = useState<number>(-1);
  const [submissions, setSubmissions] = useState<Record<string, SubmissionData>>({});
  const [loadingSubmissions, setLoadingSubmissions] = useState(false);
  const [comments, setComments] = useState<Record<string, DiscussionComment[]>>({});
  const [loadingComments, setLoadingComments] = useState(false);
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
  const [groupMembershipByStudent, setGroupMembershipByStudent] = useState<Record<string, string>>(
    {},
  );
  const [loadingGroupMemberships, setLoadingGroupMemberships] = useState(false);

  // Grade editing state (robust, GradesCard style)
  const [editingGrade, setEditingGrade] = useState<string>('');
  const [isEditing, setIsEditing] = useState(false);
  const [isSavingGrade, setIsSavingGrade] = useState(false);
  const [gradeError, setGradeError] = useState<string | null>(null);
  const [userGrade, setUserGrade] = useState<number | null>(null);
  const [isLoadingGrade, setIsLoadingGrade] = useState(false);
  const [problemGrades, setProblemGrades] = useState<Record<string, number | null>>({});
  const [gradeInputs, setGradeInputs] = useState<Record<string, string>>({});
  const [problemGradeErrors, setProblemGradeErrors] = useState<Record<string, string | null>>({});
  const [savingProblemGrades, setSavingProblemGrades] = useState<Record<string, boolean>>({});
  const [loadingProblemGrades, setLoadingProblemGrades] = useState(false);
  const [showStudentDataLoading, setShowStudentDataLoading] = useState(false);
  const [studentGradeStatuses, setStudentGradeStatuses] = useState<Record<string, boolean>>({});
  const [openDialog, setOpenDialog] = useState<{
    open: boolean;
    submission: Submission | null;
  }>({ open: false, submission: null });
  const reviewDataAbortRef = useRef<AbortController | null>(null);
  const reviewRequestSeqRef = useRef(0);

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
        title: problem.title
          ? limitText(problem.title, 25)
          : `Problem ${index + 1}`,
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
    const validProblemId = visibleProblems.some((p) => p.id === paramProblemId)
      ? (paramProblemId as string)
      : visibleProblems[0].id;

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

  // Preload group membership once per course/group set to avoid repeated network calls
  // when navigating between students.
  useEffect(() => {
    let cancelled = false;
    async function loadGroupMemberships() {
      if (!assignmentIsGroup || !groups || groups.length === 0) {
        setGroupMembershipByStudent({});
        setLoadingGroupMemberships(false);
        return;
      }

      setLoadingGroupMemberships(true);

      try {
        const ops = groups.map((g) =>
          fetch(`/api/courses/${courseId}/groups/${g.id}/members`)
            .then((res) => (res.ok ? res.json() : Promise.resolve({ members: [] })))
            .then((data) => ({ id: g.id, members: data?.members ?? [] }))
            .catch(() => ({ id: g.id, members: [] })),
        );
        const results = await Promise.all(ops);
        if (cancelled) return;

        const membershipMap: Record<string, string> = {};
        for (const result of results) {
          for (const member of result.members as Array<{ userId: string }>) {
            if (!membershipMap[member.userId]) {
              membershipMap[member.userId] = result.id;
            }
          }
        }

        setGroupMembershipByStudent(membershipMap);
      } catch (err) {
        console.error('Failed to preload group memberships:', err);
        if (!cancelled) setGroupMembershipByStudent({});
      } finally {
        if (!cancelled) setLoadingGroupMemberships(false);
      }
    }

    loadGroupMemberships();
    return () => {
      cancelled = true;
    };
  }, [assignmentIsGroup, groups, courseId]);

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

  // Fetch students
  useEffect(() => {
    const fetchStudents = async () => {
      try {
        const res = await fetch(`/api/courses/${courseId}/students`);
        if (!res.ok) throw new Error((await res.json())?.error || 'Failed to load students');
        const data: Person[] = await res.json();
        // Sort students alphabetically by last name, then first name (case-insensitive)
        data.sort((a, b) => {
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
        setStudents(data);
      } catch (err) {
        console.error('Fetch students error:', err);
        showToast.error('Failed to load students');
        setStudents([]);
      }
    };
    fetchStudents();
  }, [courseId]);

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

  useEffect(() => {
    const fetchGradeSummary = async () => {
      if (students.length === 0) {
        setStudentGradeStatuses({});
        return;
      }
      try {
        const res = await fetch(`/api/courses/${courseId}/${assignmentId}/problem-grades/summary`);
        if (!res.ok) {
          if ([401, 403, 404].includes(res.status)) {
            setStudentGradeStatuses({});
            return;
          }
          throw new Error((await res.json())?.error || 'Failed to load grade summary');
        }
        const data = ((await res.json()) ?? {}) as Record<string, boolean>;
        const normalized: Record<string, boolean> = {};
        students.forEach((student) => {
          normalized[student.id] = Boolean(data?.[student.id]);
        });
        setStudentGradeStatuses(normalized);
      } catch (error) {
        console.error('Failed to load grade summary:', error);
      }
    };

    fetchGradeSummary();
  }, [assignmentId, courseId, students]);

  const fetchReviewData = useCallback(async () => {
    if (!selectedStudentId) {
      reviewDataAbortRef.current?.abort();
      reviewDataAbortRef.current = null;
      setSubmissions({});
      setComments({});
      setProblemGrades({});
      setGradeInputs({});
      setProblemGradeErrors({});
      setLoadingSubmissions(false);
      setLoadingComments(false);
      setLoadingProblemGrades(false);
      return;
    }

    setLoadingSubmissions(true);
    setLoadingComments(true);
    setLoadingProblemGrades(true);

    reviewDataAbortRef.current?.abort();
    const controller = new AbortController();
    reviewDataAbortRef.current = controller;
    const requestSeq = ++reviewRequestSeqRef.current;

    try {
      const res = await fetch(
        `/api/courses/${courseId}/${assignmentId}/review-data/${selectedStudentId}`,
        { signal: controller.signal },
      );

      if (requestSeq !== reviewRequestSeqRef.current) return;

      if (!res.ok) {
        if ([401, 403, 404].includes(res.status)) {
          if (requestSeq !== reviewRequestSeqRef.current) return;
          setSubmissions({});
          setComments(
            Object.fromEntries(
              assignmentProblems.map((problem) => [problem.id, [] as DiscussionComment[]]),
            ),
          );
          setProblemGrades({});
          setGradeInputs({});
          setProblemGradeErrors({});
          return;
        }
        throw new Error((await res.json())?.error || 'Failed to load review data');
      }

      type ReviewDataResponse = {
        submissions?: Record<string, SubmissionData>;
        comments?: Array<DiscussionComment & { problemId?: string | null }>;
        problemGrades?: Record<string, { grade: number | null; feedback: string | null }>;
      };

      const data = ((await res.json()) ?? {}) as ReviewDataResponse;
      if (requestSeq !== reviewRequestSeqRef.current) return;
      setSubmissions(data.submissions || {});

      const groupedComments = Object.fromEntries(
        assignmentProblems.map((problem) => [problem.id, [] as DiscussionComment[]]),
      ) as Record<string, DiscussionComment[]>;

      for (const comment of data.comments ?? []) {
        const problemId = comment.problemId;
        if (problemId && groupedComments[problemId]) {
          groupedComments[problemId].push(comment);
        }
      }
      setComments(groupedComments);

      const gradeData = data.problemGrades ?? {};
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
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      if (requestSeq !== reviewRequestSeqRef.current) return;
      console.error('Fetch review data error:', err);
      showToast.error('Failed to load review data');
      setSubmissions({});
      setComments({});
      setProblemGrades({});
      setGradeInputs({});
    } finally {
      if (requestSeq !== reviewRequestSeqRef.current) return;
      setLoadingSubmissions(false);
      setLoadingComments(false);
      setLoadingProblemGrades(false);
    }
  }, [courseId, assignmentId, selectedStudentId, assignmentProblems]);

  useEffect(() => {
    return () => {
      reviewDataAbortRef.current?.abort();
      reviewDataAbortRef.current = null;
    };
  }, []);

  // Fetch review data for selected student
  useEffect(() => {
    fetchReviewData();
  }, [fetchReviewData]);

  const handleRerunSubmission = useCallback(
    async (submission: Submission) => {
      if (!submission?.id) return;
      setRerunning((prev) => ({ ...prev, [submission.id]: true }));
      try {
        const res = await fetch(`/api/submissions/${submission.id}/rerun`, {
          method: 'POST',
        });
        if (!res.ok) {
          const error = await res.json().catch(() => ({}));
          throw new Error(error?.error || 'Failed to rerun submission');
        }
        showToast.success('Submission re-evaluated');
        await fetchReviewData();
      } catch (err) {
        console.error('Rerun submission error:', err);
        showToast.error(err instanceof Error ? err.message : 'Failed to rerun submission');
      } finally {
        setRerunning((prev) => ({ ...prev, [submission.id]: false }));
      }
    },
    [fetchReviewData],
  );

  const saveComment = useCallback(
    async (problemId: string) => {
      const commentText = commentTexts[problemId]?.trim();
      if (!commentText || !selectedStudent) return;

      setSavingComments((prev) => ({ ...prev, [problemId]: true }));
      try {
        const response = await fetch('/api/comments', {
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
        showToast.success('Comment saved successfully');
      } catch (err) {
        console.error('Save comment error:', err);
        showToast.error(err instanceof Error ? err.message : 'Failed to save comment');
      } finally {
        setSavingComments((prev) => ({ ...prev, [problemId]: false }));
      }
    },
    [commentTexts, selectedStudent, assignmentId],
  );

  const deleteComment = useCallback(async (commentId: string, problemId: string) => {
    setDeletingComments((prev) => ({ ...prev, [commentId]: true }));
    try {
      const response = await fetch(`/api/comments?commentId=${commentId}`, {
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
      showToast.success('Comment deleted successfully');
    } catch (err) {
      console.error('Delete comment error:', err);
      showToast.error(err instanceof Error ? err.message : 'Failed to delete comment');
    } finally {
      setDeletingComments((prev) => ({ ...prev, [commentId]: false }));
    }
  }, []);

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
          `/api/courses/${courseId}/${assignmentId}/problems/${problemId}/grade/${selectedStudent.id}`,
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
                        onCommentTextChange={(text) =>
                          selectedProblem &&
                          setCommentTexts((prev) => ({
                            ...prev,
                            [selectedProblem.id]: text,
                          }))
                        }
                        onSaveComment={() => selectedProblem && saveComment(selectedProblem.id)}
                        onDeleteComment={(commentId) =>
                          selectedProblem && deleteComment(commentId, selectedProblem.id)
                        }
                        isSaving={selectedProblem ? savingComments[selectedProblem.id] : false}
                        deletingComments={deletingComments}
                        onViewSubmission={(submission) => setOpenDialog({ open: true, submission })}
                        onRerunSubmission={handleRerunSubmission}
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
            src={`/api/uploads/submissions/${encodeURIComponent(
              openDialog.submission.fileName ?? '',
            )}`}
            title={`${openDialog.submission.originalFileName || openDialog.submission.fileName} - Submission`}
            width="70vw"
            height="70vh"
          />
        )}
      {openDialog.submission &&
        (visibleProblems.find((p) => p.id === selectedProblemId)?.type ?? '') === 'RE' && (
          <RegexViewerDialog
            open={openDialog.open}
            onOpenChange={(open) => setOpenDialog({ open, submission: null })}
            src={`/api/uploads/submissions/${encodeURIComponent(
              openDialog.submission.fileName ?? '',
            )}`}
            title={`${openDialog.submission.originalFileName || openDialog.submission.fileName} - Submission`}
          />
        )}
      {openDialog.submission &&
        (visibleProblems.find((p) => p.id === selectedProblemId)?.type ?? '') === 'CFG' && (
          <CfgViewerDialog
            open={openDialog.open}
            onOpenChange={(open) => setOpenDialog({ open, submission: null })}
            src={`/api/uploads/submissions/${encodeURIComponent(
              openDialog.submission.fileName ?? '',
            )}`}
            title={`${openDialog.submission.originalFileName || openDialog.submission.fileName} - Submission`}
          />
        )}
    </div>
  );
}
