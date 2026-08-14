'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { showToast } from '@/lib/toast';
import { queryKeys } from '@/lib/query-keys';
import {
  fetchAssignmentsForCourses,
  fetchCourseList,
  fetchProblemsForAssignments,
  type AssignmentItem,
  type CourseItem,
  type ProblemItem,
} from './submissions-data';

/**
 * The three cascading pickers at the top of the submissions page: courses, then the
 * assignments in them, then the problems on those.
 *
 * Pulled out of the component because it is one concern spread over eleven hooks, and because
 * the pruning below is the fiddly part of the page and was only reachable by rendering all of
 * it. What makes it fiddly is that the selection and the list it draws from are updated by
 * different things: the user picks ids, and a query later decides which of them still exist.
 */

// Stable empty arrays so `data ?? EMPTY` keeps a constant identity between renders, which
// keeps the option memos below from rebuilding on every render.
const EMPTY_COURSES: CourseItem[] = [];
const EMPTY_ASSIGNMENTS: AssignmentItem[] = [];
const EMPTY_PROBLEMS: ProblemItem[] = [];

/** One entry in a picker: the id that filters, and what the user reads. */
export type FilterOption = { id: string; label: string };

export function useSubmissionFilters() {
  // Scope. Empty means "everything", so the page opens unfiltered without enumerating every
  // id in the installation, and the assignment/problem lists are only fetched once the admin
  // actually narrows. Selecting all of them used to fan out one request per course and then
  // one per assignment before the table could show anything.
  const [selectedCourses, setSelectedCourses] = useState<string[]>([]);
  const [selectedAssignments, setSelectedAssignments] = useState<string[]>([]);
  const [selectedProblems, setSelectedProblems] = useState<string[]>([]);

  // Each list is a cached, deduped, retried query. staleTime:Infinity means a list only
  // refetches when the selection above it changes (its key), so a background refetch never
  // re-runs the select-all cascade and wipes a manual narrowing.
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
  //
  // Only once the list has settled, though. Changing the selection above changes this query's
  // key, and until the answer arrives `data` is undefined and the list reads as empty. Pruning
  // against that emptied it every time: adding a second course dropped the assignment filter
  // the user had just set, with nothing on screen to say why.
  useEffect(() => {
    if (loadingAssignments) return;
    setSelectedAssignments((prev) =>
      prev.filter((id) => assignments.some((assignment) => assignment.id === id)),
    );
  }, [assignments, loadingAssignments]);

  useEffect(() => {
    if (loadingProblems) return;
    setSelectedProblems((prev) => prev.filter((id) => problems.some((p) => p.id === id)));
  }, [problems, loadingProblems]);

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

  const courseOptions: FilterOption[] = useMemo(
    () => courses.map((course) => ({ id: course.id, label: course.name })),
    [courses],
  );

  const assignmentOptions: FilterOption[] = useMemo(
    () =>
      assignments
        .map((assignment) => ({ id: assignment.id, label: assignment.title }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [assignments],
  );

  const problemOptions: FilterOption[] = useMemo(
    () =>
      problems
        .map((problem) => ({ id: problem.id, label: problem.title || problem.id }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [problems],
  );

  /** Drop every scope selection at once, for the page's Clear filters button. */
  const clearScope = () => {
    setSelectedCourses([]);
    setSelectedAssignments([]);
    setSelectedProblems([]);
  };

  const anyScopeActive =
    selectedCourses.length > 0 || selectedAssignments.length > 0 || selectedProblems.length > 0;

  return {
    selectedCourses,
    selectedAssignments,
    selectedProblems,
    setSelectedCourses,
    setSelectedAssignments,
    setSelectedProblems,
    courseOptions,
    assignmentOptions,
    problemOptions,
    loadingCourses,
    loadingAssignments,
    loadingProblems,
    clearScope,
    anyScopeActive,
  };
}
