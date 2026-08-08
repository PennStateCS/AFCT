'use client';

import { useCallback, useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { showToast } from '@/lib/toast';
import { apiPaths } from '@/lib/api-paths';
import { apiClient } from '@/lib/api/fetch-client';
import type { ReviewDataResponse } from './useReviewData';

type GradeableProblem = { id: string; title?: string; maxPoints?: number };
type Person = { id: string; firstName?: string | null; lastName?: string | null };

type UseProblemGradesArgs = {
  courseId: string;
  assignmentId: string;
  courseIsArchived: boolean;
  /** Every student in the picker, used to normalize the graded-or-not map. */
  students: Person[];
  selectedStudent: Person | null;
  assignmentProblems: GradeableProblem[];
  reviewData: ReviewDataResponse | undefined;
  reviewQueryIsError: boolean;
  reviewError: unknown;
};

/**
 * The grade half of the submissions review page: the editable per-problem fields for the
 * selected student, the save, and the graded-or-not dot each student carries in the picker.
 *
 * Two things here are deliberate and easy to break.
 *
 * The summary query seeds `studentGradeStatuses`, but a save updates that map optimistically
 * and does NOT invalidate the summary: refetching it would overwrite the optimistic value
 * with a server answer computed before the write landed, and the dot would flicker back to
 * "missing grades" for a student who was just fully graded.
 *
 * The "could not load this submission" toast lives inside the seeding effect rather than in
 * an effect of its own. That is where the failed load is observed, and giving it its own
 * effect would change how often it fires.
 */
export function useProblemGrades({
  courseId,
  assignmentId,
  courseIsArchived,
  students,
  selectedStudent,
  assignmentProblems,
  reviewData,
  reviewQueryIsError,
  reviewError,
}: UseProblemGradesArgs) {
  const queryClient = useQueryClient();
  const selectedStudentId = selectedStudent?.id ?? null;

  const [problemGrades, setProblemGrades] = useState<Record<string, number | null>>({});
  const [gradeInputs, setGradeInputs] = useState<Record<string, string>>({});
  const [problemGradeErrors, setProblemGradeErrors] = useState<Record<string, string | null>>({});
  const [savingProblemGrades, setSavingProblemGrades] = useState<Record<string, boolean>>({});
  const [studentGradeStatuses, setStudentGradeStatuses] = useState<Record<string, boolean>>({});

  // Grade summary: cached read of which students have all problems graded.
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

  // Seed the base studentGradeStatuses from the summary, normalized over students. This
  // local state is also updated by grade saves and review-data seeding, so we do NOT
  // invalidate the summary on save.
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

  // Seed the local editable GRADE state from the cached review data. When there is no
  // selected student, clear it.
  useEffect(() => {
    if (!selectedStudentId) {
      setProblemGrades({});
      setGradeInputs({});
      setProblemGradeErrors({});
      return;
    }

    if (reviewQueryIsError) {
      console.error('Fetch review data error:', reviewError);
      showToast.error('Could not load this submission. Refresh the page to try again.');
      setProblemGrades({});
      setGradeInputs({});
      return;
    }

    if (reviewData === undefined) return;

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
  }, [selectedStudentId, reviewData, reviewQueryIsError, reviewError, assignmentProblems]);

  const handleGradeInputChange = useCallback((problemId: string, value: string) => {
    setGradeInputs((prev) => ({ ...prev, [problemId]: value }));
    setProblemGradeErrors((prev) => ({ ...prev, [problemId]: null }));
  }, []);

  const saveProblemGrade = useCallback(
    async (problemId: string) => {
      if (!selectedStudent) return;
      if (courseIsArchived) {
        showToast.error(
          'This course is archived, so grades cannot be edited. Unarchive the course to make changes.',
        );
        return;
      }

      const problem = assignmentProblems.find((p) => p.id === problemId);
      if (!problem) return;
      const rawMaxPoints = typeof problem.maxPoints === 'number' ? problem.maxPoints : null;
      const hasUpperBound = typeof rawMaxPoints === 'number' && rawMaxPoints >= 0;
      const rawValue = gradeInputs[problemId] ?? '';
      const trimmed = rawValue.trim();
      const numericValue = trimmed === '' ? null : Number(trimmed);

      // Each of these shows the same sentence twice on purpose: inline next to the field, so it
      // stays put while the grader fixes it, and as a toast, because the field can be scrolled
      // out of view in a long problem list.
      if (numericValue !== null) {
        const message = Number.isNaN(numericValue)
          ? 'Enter the grade as a number.'
          : numericValue < 0
            ? 'Enter a grade of at least 0.'
            : hasUpperBound && rawMaxPoints !== null && numericValue > rawMaxPoints
              ? `Enter a grade between 0 and ${rawMaxPoints}.`
              : null;
        if (message) {
          setProblemGradeErrors((prev) => ({ ...prev, [problemId]: message }));
          showToast.error(message);
          return;
        }
      }

      setProblemGradeErrors((prev) => ({ ...prev, [problemId]: null }));
      setSavingProblemGrades((prev) => ({ ...prev, [problemId]: true }));

      try {
        await apiClient.post(
          apiPaths.assignmentProblemGrade(courseId, assignmentId, problemId, selectedStudent.id),
          { grade: numericValue },
        );

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
        void queryClient.invalidateQueries({
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

  return {
    problemGrades,
    gradeInputs,
    problemGradeErrors,
    savingProblemGrades,
    studentGradeStatuses,
    handleGradeInputChange,
    saveProblemGrade,
  };
}
