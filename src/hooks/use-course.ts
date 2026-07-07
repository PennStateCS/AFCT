'use client';

import { useState, useEffect, useCallback } from 'react';
import type { SetStateAction } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { showToast } from '@/lib/toast';
import { FullCourse, DeleteTarget, EnrollableUser, TabType } from '@/types/course';
import { getEnrolledIds, type EnrolledUser } from '@/lib/course-utils';
import { Assignment, Problem, User } from '@prisma/client';

type CourseSectionView = 'summary' | 'full' | 'assignments' | 'problems' | 'roster';
type SectionKey = 'assignments' | 'problems' | 'roster';

/** Cache key for a course view; shared so callers can invalidate consistently. */
export const courseQueryKey = (courseId: string, view: CourseSectionView) =>
  ['course', courseId, view] as const;

/**
 * Course data hook backed by the TanStack Query cache. Every view fetch goes
 * through `queryClient.fetchQuery`, so the cache dedupes in-flight requests and
 * serves warm data instantly when the user navigates back to a course (no network
 * within the staleTime window). Local component state still drives rendering and
 * optimistic `setCourse` updates — those are mirrored into the base cache entry so
 * the cache stays consistent with what the user sees.
 */
export function useCourseData(
  courseId: string,
  options?: { initialCourse?: FullCourse | null; isStudent?: boolean },
) {
  const queryClient = useQueryClient();
  const isStudent = !!options?.isStudent;
  const baseView: CourseSectionView = isStudent ? 'full' : 'summary';

  // Seed from a warm cache entry (fast back-navigation) before the SSR prop.
  const [course, setCourseState] = useState<FullCourse | null>(
    () =>
      (courseId
        ? (queryClient.getQueryData(courseQueryKey(courseId, baseView)) as FullCourse | undefined)
        : undefined) ??
      options?.initialCourse ??
      null,
  );
  const [loadingSections, setLoadingSections] = useState<Record<SectionKey, boolean>>({
    assignments: false,
    problems: false,
    roster: false,
  });

  // setCourse mirrors optimistic updates into the base cache entry so the cached
  // course matches what's rendered (keeps back-navigation showing current data).
  const setCourse = useCallback(
    (updater: SetStateAction<FullCourse | null>) => {
      setCourseState((prev) => {
        const next = typeof updater === 'function' ? updater(prev) : updater;
        if (courseId) queryClient.setQueryData(courseQueryKey(courseId, baseView), next);
        return next;
      });
    },
    [courseId, baseView, queryClient],
  );

  const fetchCourseByView = useCallback(
    async (view: CourseSectionView): Promise<FullCourse | null> => {
      if (!courseId) return null;
      return queryClient.fetchQuery({
        queryKey: courseQueryKey(courseId, view),
        queryFn: async () => {
          const res = await fetch(`/api/courses/${courseId}?view=${view}`);
          if (!res.ok) throw new Error('Failed to fetch course');
          return (await res.json()) as FullCourse;
        },
      });
    },
    [courseId, queryClient],
  );

  const fetchCourse = useCallback(async () => {
    try {
      const data = await fetchCourseByView(baseView);
      if (!data) return;
      setCourse({
        ...data,
        // normalize to `enrolled` representation (user objects with courseRole)
        enrolled: data.enrolled || [],
        assignments: data.assignments || [],
        problems: data.problems || [],
      });
    } catch (error) {
      showToast.error('Failed to load course');
      console.error('Error fetching course:', error);
    }
  }, [fetchCourseByView, baseView, setCourse]);

  const loadTabData = useCallback(
    async (tab: TabType) => {
      if (!courseId || isStudent) return;
      const section = tab as SectionKey;
      if (section !== 'assignments' && section !== 'problems' && section !== 'roster') return;
      try {
        setLoadingSections((prev) => ({ ...prev, [section]: true }));
        // Served from the query cache when fresh; refetched when stale/invalidated.
        const data = await fetchCourseByView(section);
        setLoadingSections((prev) => ({ ...prev, [section]: false }));
        if (!data) return;
        setCourse((prev) =>
          prev
            ? {
                ...prev,
                ...(section === 'assignments'
                  ? { assignments: data.assignments ?? prev.assignments ?? [] }
                  : {}),
                ...(section === 'problems'
                  ? { problems: data.problems ?? prev.problems ?? [] }
                  : {}),
                ...(section === 'roster' ? { enrolled: data.enrolled ?? prev.enrolled ?? [] } : {}),
              }
            : {
                ...data,
                assignments: data.assignments ?? [],
                problems: data.problems ?? [],
                enrolled: data.enrolled ?? [],
              },
        );
      } catch (error) {
        setLoadingSections((prev) => ({ ...prev, [section]: false }));
        showToast.error('Failed to load tab data');
        console.error('Error loading tab data:', error);
      }
    },
    [courseId, isStudent, fetchCourseByView, setCourse],
  );

  // Invalidate the whole course (all views) then re-pull the base view. Section
  // tabs re-pull lazily on next visit because their cache entries are now stale.
  const refetchCourse = useCallback(async () => {
    if (courseId) await queryClient.invalidateQueries({ queryKey: ['course', courseId] });
    await fetchCourse();
  }, [courseId, queryClient, fetchCourse]);

  // Warm the base cache entry from the SSR-provided course on first mount.
  useEffect(() => {
    if (!courseId || !options?.initialCourse) return;
    if (queryClient.getQueryData(courseQueryKey(courseId, baseView)) === undefined) {
      queryClient.setQueryData(courseQueryKey(courseId, baseView), options.initialCourse);
    }
    // Only on mount / course change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courseId]);

  useEffect(() => {
    if (!course) {
      fetchCourse();
      return;
    }
    // Students need full assignment data for their default view.
    if (isStudent && course.assignments.length === 0) {
      fetchCourse();
    }
  }, [fetchCourse, course, isStudent]);

  return {
    course,
    setCourse,
    refetchCourse,
    loadTabData,
    loadingSections,
  };
}

export function useTabNavigation() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [tab, setTab] = useState<TabType>((searchParams.get('tab') as TabType) || 'assignments');

  const handleTabChange = useCallback(
    (value: string) => {
      setTab(value as TabType);
      const params = new URLSearchParams(searchParams.toString());
      params.set('tab', value);
      router.replace(`?${params.toString()}`);
    },
    [searchParams, router],
  );

  return { tab, handleTabChange };
}

export function useDialogStates() {
  // Edit course dialog
  const [editOpen, setEditOpen] = useState(false);

  // Problem dialogs
  const [problemOpen, setProblemOpen] = useState(false);
  const [editProblemOpen, setEditProblemOpen] = useState(false);
  const [selectedProblem, setSelectedProblem] = useState<Problem | null>(null);

  // Assignment dialogs
  const [editAssignmentOpen, setEditAssignmentOpen] = useState(false);
  const [selectedAssignment, setSelectedAssignment] = useState<Assignment | null>(null);
  const [createAssignmentOpen, setCreateAssignmentOpen] = useState(false);

  // Delete confirm
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<DeleteTarget | null>(null);

  // Publish confirm
  const [publishConfirmOpen, setPublishConfirmOpen] = useState(false);
  const [pendingPublish, setPendingPublish] = useState<boolean | null>(null);

  // Archive confirm
  const [archiveConfirmOpen, setArchiveConfirmOpen] = useState(false);
  const [pendingArchive, setPendingArchive] = useState<boolean | null>(null);

  // Enroll user
  const [enrollOpen, setEnrollOpen] = useState(false);
  const [allUsers, setAllUsers] = useState<EnrollableUser[]>([]);

  return {
    editOpen,
    setEditOpen,

    problemOpen,
    setProblemOpen,
    editProblemOpen,
    setEditProblemOpen,
    selectedProblem,
    setSelectedProblem,

    editAssignmentOpen,
    setEditAssignmentOpen,
    selectedAssignment,
    setSelectedAssignment,
    createAssignmentOpen,
    setCreateAssignmentOpen,
    confirmOpen,
    setConfirmOpen,
    pendingDelete,
    setPendingDelete,

    publishConfirmOpen,
    setPublishConfirmOpen,
    pendingPublish,
    setPendingPublish,

    archiveConfirmOpen,
    setArchiveConfirmOpen,
    pendingArchive,
    setPendingArchive,

    enrollOpen,
    setEnrollOpen,
    allUsers,
    setAllUsers,
  };
}

export function useEnrollment(course: FullCourse | null) {
  const [allUsers, setAllUsers] = useState<EnrollableUser[]>([]);

  const fetchAvailableUsers = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/users');
      if (!res.ok) throw new Error('Failed to fetch users');
      const users: User[] = await res.json();

      if (course) {
        const inCourseIds = new Set(getEnrolledIds(course.enrolled as EnrolledUser[]));
        const available = users.filter((u) => !inCourseIds.has(u.id));
        setAllUsers(available);
        return available;
      }
      setAllUsers(users as unknown as EnrollableUser[]);
      return users as unknown as EnrollableUser[];
    } catch (error) {
      showToast.error('Failed to load user list');
      console.error('Error fetching users:', error);
      return [] as EnrollableUser[];
    }
  }, [course]);

  const handleEnrollUser = useCallback(
    async (user: EnrollableUser, courseId: string, refetchCourse: () => void) => {
      try {
        const res = await fetch(`/api/courses/${courseId}/enroll`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: user.id }),
        });
        if (!res.ok) throw new Error('Failed to enroll user');
        showToast.success('User enrolled!');
        refetchCourse();
      } catch (error) {
        showToast.error('Error enrolling user');
        console.error('Error enrolling user:', error);
      }
    },
    [],
  );

  return {
    allUsers,
    fetchAvailableUsers,
    handleEnrollUser,
  };
}
