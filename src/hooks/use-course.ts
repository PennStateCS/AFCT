import { useState, useEffect, useCallback } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { showToast } from '@/lib/toast';
import { FullCourse, DeleteTarget, EnrollableUser, TabType } from '@/types/course';
import { getEnrolledIds } from '@/lib/course-utils';
import { Assignment, Problem, User } from '@prisma/client';

export function useCourseData(courseId: string) {
  const [course, setCourse] = useState<FullCourse | null>(null);

  const fetchCourse = useCallback(async () => {
    try {
      const res = await fetch(`/api/courses/${courseId}`);
      if (!res.ok) throw new Error('Failed to fetch course');
      const data = await res.json();
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
  }, [courseId]);

  useEffect(() => {
    fetchCourse();
  }, [fetchCourse]);

  return { course, setCourse, refetchCourse: fetchCourse };
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
        const inCourseIds = new Set(getEnrolledIds(course.enrolled as any[]));
        setAllUsers(users.filter((u) => !inCourseIds.has(u.id)));
      }
    } catch (error) {
      showToast.error('Failed to load user list');
      console.error('Error fetching users:', error);
    }
  }, [course]);

  const handleEnrollUser = useCallback(async (user: EnrollableUser, courseId: string, refetchCourse: () => void) => {
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
  }, []);

  return {
    allUsers,
    fetchAvailableUsers,
    handleEnrollUser,
  };
}
