'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { showToast } from '@/lib/toast';
import { FullCourse, DeleteTarget, EnrollableUser, TabType } from '@/types/course';
import { getEnrolledIds, type EnrolledUser } from '@/lib/course-utils';
import { Assignment, Problem, User } from '@prisma/client';

type CourseSectionView = 'summary' | 'full' | 'assignments' | 'problems' | 'roster';

export function useCourseData(
  courseId: string,
  options?: { initialCourse?: FullCourse | null; isStudent?: boolean },
) {
  const courseRequestSeqRef = useRef(0);
  const sectionRequestSeqRef = useRef({ assignments: 0, problems: 0, roster: 0 });
  const [course, setCourse] = useState<FullCourse | null>(options?.initialCourse ?? null);
  const [loadedSections, setLoadedSections] = useState<{
    assignments: boolean;
    problems: boolean;
    roster: boolean;
  }>({
    assignments: !!options?.isStudent,
    problems: !!options?.isStudent,
    roster: !!options?.isStudent,
  });
  const [loadingSections, setLoadingSections] = useState<{
    assignments: boolean;
    problems: boolean;
    roster: boolean;
  }>({
    assignments: false,
    problems: false,
    roster: false,
  });

  const fetchCourseByView = useCallback(
    async (view: CourseSectionView) => {
      if (!courseId) return null;
      const res = await fetch(`/api/courses/${courseId}?view=${view}`);
      if (!res.ok) throw new Error('Failed to fetch course');
      return res.json();
    },
    [courseId],
  );

  const fetchCourse = useCallback(async () => {
    const requestSeq = ++courseRequestSeqRef.current;
    try {
      const data = await fetchCourseByView(options?.isStudent ? 'full' : 'summary');
      if (requestSeq !== courseRequestSeqRef.current) return;
      if (!data) return;
      setCourse({
        ...data,
        // normalize to `enrolled` representation (user objects with courseRole)
        enrolled: data.enrolled || [],
        assignments: data.assignments || [],
        problems: data.problems || [],
      });
    } catch (error) {
      if (requestSeq !== courseRequestSeqRef.current) return;
      showToast.error('Failed to load course');
      console.error('Error fetching course:', error);
    }
  }, [fetchCourseByView, options?.isStudent]);

  const loadTabData = useCallback(
    async (tab: TabType) => {
      if (!courseId || options?.isStudent) return;
      try {
        if (tab === 'assignments' && !loadedSections.assignments && !loadingSections.assignments) {
          const requestSeq = ++sectionRequestSeqRef.current.assignments;
          setLoadingSections((prev) => ({ ...prev, assignments: true }));
          const data = await fetchCourseByView('assignments');
          if (requestSeq !== sectionRequestSeqRef.current.assignments) return;
          if (!data) return;
          setCourse((prev) =>
            prev
              ? { ...prev, assignments: data.assignments ?? prev.assignments ?? [] }
              : {
                  ...data,
                  assignments: data.assignments ?? [],
                  problems: data.problems ?? [],
                  enrolled: data.enrolled ?? [],
                },
          );
          setLoadedSections((prev) => ({ ...prev, assignments: true }));
          setLoadingSections((prev) => ({ ...prev, assignments: false }));
        }

        if (tab === 'problems' && !loadedSections.problems && !loadingSections.problems) {
          const requestSeq = ++sectionRequestSeqRef.current.problems;
          setLoadingSections((prev) => ({ ...prev, problems: true }));
          const data = await fetchCourseByView('problems');
          if (requestSeq !== sectionRequestSeqRef.current.problems) return;
          if (!data) return;
          setCourse((prev) =>
            prev
              ? { ...prev, problems: data.problems ?? prev.problems ?? [] }
              : {
                  ...data,
                  assignments: data.assignments ?? [],
                  problems: data.problems ?? [],
                  enrolled: data.enrolled ?? [],
                },
          );
          setLoadedSections((prev) => ({ ...prev, problems: true }));
          setLoadingSections((prev) => ({ ...prev, problems: false }));
        }

        if (tab === 'roster' && !loadedSections.roster && !loadingSections.roster) {
          const requestSeq = ++sectionRequestSeqRef.current.roster;
          setLoadingSections((prev) => ({ ...prev, roster: true }));
          const data = await fetchCourseByView('roster');
          if (requestSeq !== sectionRequestSeqRef.current.roster) return;
          if (!data) return;
          setCourse((prev) =>
            prev
              ? { ...prev, enrolled: data.enrolled ?? prev.enrolled ?? [] }
              : {
                  ...data,
                  assignments: data.assignments ?? [],
                  problems: data.problems ?? [],
                  enrolled: data.enrolled ?? [],
                },
          );
          setLoadedSections((prev) => ({ ...prev, roster: true }));
          setLoadingSections((prev) => ({ ...prev, roster: false }));
        }
      } catch (error) {
        if (tab === 'assignments') {
          setLoadingSections((prev) => ({ ...prev, assignments: false }));
        }
        if (tab === 'problems') {
          setLoadingSections((prev) => ({ ...prev, problems: false }));
        }
        if (tab === 'roster') {
          setLoadingSections((prev) => ({ ...prev, roster: false }));
        }
        showToast.error('Failed to load tab data');
        console.error('Error loading tab data:', error);
      }
    },
    [courseId, fetchCourseByView, loadedSections, loadingSections, options?.isStudent],
  );

  useEffect(() => {
    if (!course) {
      fetchCourse();
      return;
    }

    // Students need full assignment data for their default view.
    if (options?.isStudent && course.assignments.length === 0) {
      fetchCourse();
    }
  }, [fetchCourse, course, options?.isStudent]);

  return {
    course,
    setCourse,
    refetchCourse: fetchCourse,
    loadTabData,
    loadedSections,
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
      const res = await fetch('/api/users');
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
