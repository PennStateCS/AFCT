'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';

type SelectableProblem = { id: string };

/** Generic over the student shape so callers keep whatever fields they passed in. */
type UseReviewSelectionArgs<S extends { id: string }> = {
  students: S[];
  visibleProblems: SelectableProblem[];
};

/**
 * Which student and problem the review page is showing, kept in the URL so a link or a
 * reload lands in the same place.
 *
 * The student is held as an index into the sorted list but resolved from the id in the
 * URL, which is what keeps the selection attached to a person rather than a position: the
 * list is refetched, and someone enrolling can push the selected student down it.
 *
 * The URL is updated with `history.replaceState`, not `router.replace`. This route is a
 * dynamic server component, so a navigation would fetch a fresh RSC payload and re-run the
 * page's database queries every time a grader clicked a student, for data the query cache
 * already holds.
 */
export function useReviewSelection<S extends { id: string }>({
  students,
  visibleProblems,
}: UseReviewSelectionArgs<S>) {
  const searchParams = useSearchParams();
  const searchParamsString = searchParams.toString();
  const selectedStudentIdParam = searchParams.get('studentId');

  const [selectedIndex, setSelectedIndex] = useState<number>(-1);
  const [selectedProblemId, setSelectedProblemId] = useState<string | null>(null);

  const setUrlParam = useCallback(
    (key: string, value: string) => {
      const params = new URLSearchParams(searchParamsString);
      if (params.get(key) === value) return;
      params.set(key, value);
      window.history.replaceState(null, '', `?${params.toString()}`);
    },
    [searchParamsString],
  );

  const updateQuery = useCallback(
    (problemId: string) => setUrlParam('problemId', problemId),
    [setUrlParam],
  );

  const updateStudentQuery = useCallback(
    (studentId: string) => setUrlParam('studentId', studentId),
    [setUrlParam],
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

  const handleSelectProblem = useCallback(
    (problemId: string) => {
      setSelectedProblemId(problemId);
      updateQuery(problemId);
    },
    [updateQuery],
  );

  // URL -> index. Re-resolving from the id on every list change is what survives a refetch
  // that inserts someone above the selected student.
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

  // index -> URL, for the arrow keys and the picker, which move the index directly.
  useEffect(() => {
    if (!selectedStudent) return;
    if (selectedStudentIdParam !== selectedStudent.id) {
      updateStudentQuery(selectedStudent.id);
    }
  }, [selectedStudentIdParam, selectedStudent, updateStudentQuery]);

  const handleSelectChange = useCallback(
    (id: string) => {
      const index = students.findIndex((s) => s.id === id);
      if (index !== -1) setSelectedIndex(index);
    },
    [students],
  );

  return {
    selectedIndex,
    setSelectedIndex,
    selectedStudent,
    selectedStudentId: selectedStudent?.id ?? null,
    selectedProblemId,
    handleSelectProblem,
    handleSelectChange,
  };
}
