'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import type { Assignment, Problem } from '@prisma/client';

import type { EnrollableUser } from '@/types/course';
import {
  useCourseData,
  useTabNavigation,
  useDialogStates,
  useEnrollment,
} from '@/hooks/use-course';
import { useCourseHandlers } from '@/lib/course-handlers';
import { useEffectiveTimezone } from '@/hooks/use-effective-timezone';
import { CourseHeader } from '@/components/course/CourseHeader';
import { StudentCourseView } from '@/components/course/StudentCourseView';
import { AdminCourseView } from '@/components/course/AdminCourseView';
import LoadingSpinner from '@/components/ui/loading-spinner';
import { CourseDialogs } from '@/components/course/CourseDialogs';
import DuplicateCourseDialog from '@/components/dialogs/DuplicateCourseDialog';
import { FullCourse } from '@/types/course';
import { TabType } from '@/types/course';

export default function CourseClient({ initialCourse }: { initialCourse?: FullCourse | null }) {
  const { id } = useParams();
  const router = useRouter();
  const { data: session } = useSession();
  const courseId = Array.isArray(id) ? id[0] : id;
  const isStudent = session?.user?.role === 'STUDENT';
  const { course, setCourse, refetchCourse, loadTabData, loadingSections } = useCourseData(
    courseId || '',
    {
      initialCourse: initialCourse ?? null,
      isStudent,
    },
  );
  const { tab, handleTabChange } = useTabNavigation();
  const dialogStates = useDialogStates();
  const { allUsers, fetchAvailableUsers, handleEnrollUser } = useEnrollment(course);
  const handlers = useCourseHandlers(course, setCourse);
  const [duplicateOpen, setDuplicateOpen] = useState(false);
  const [bulkEnrollOpen, setBulkEnrollOpen] = useState(false);
  const { timezone } = useEffectiveTimezone();

  const openDuplicate = () => setDuplicateOpen(true);

  const openEnrollDialog = useCallback(async () => {
    const users = await fetchAvailableUsers();
    dialogStates.setAllUsers(users);
    dialogStates.setEnrollOpen(true);
  }, [fetchAvailableUsers, dialogStates]);

  const openBulkEnrollDialog = useCallback(() => {
    setBulkEnrollOpen(true);
  }, []);

  const handleProblemEditClick = useCallback(
    (problem: Problem) => {
      dialogStates.setSelectedProblem(problem);
      dialogStates.setEditProblemOpen(true);
    },
    [dialogStates],
  );

  const handleProblemDeleteClick = useCallback(
    (problemId: string) => {
      dialogStates.setPendingDelete({ id: problemId, type: 'problem' });
      dialogStates.setConfirmOpen(true);
    },
    [dialogStates],
  );

  const handleAssignmentEditClick = useCallback(
    (assignment: Assignment) => {
      dialogStates.setSelectedAssignment(assignment);
      dialogStates.setEditAssignmentOpen(true);
    },
    [dialogStates],
  );

  const handleAssignmentDeleteClick = useCallback(
    (assignmentId: string) => {
      dialogStates.setPendingDelete({ id: assignmentId, type: 'assignment' });
      dialogStates.setConfirmOpen(true);
    },
    [dialogStates],
  );

  const handleConfirm = useCallback(() => {
    if (dialogStates.pendingDelete) {
      handlers.handleDelete(dialogStates.pendingDelete);
    }
    dialogStates.setConfirmOpen(false);
    dialogStates.setPendingDelete(null);
  }, [dialogStates, handlers]);

  const handleCancel = useCallback(() => {
    dialogStates.setConfirmOpen(false);
    dialogStates.setPendingDelete(null);
  }, [dialogStates]);

  const handlePublishToggle = useCallback(
    (checked: boolean) => {
      dialogStates.setPendingPublish(checked);
      dialogStates.setPublishConfirmOpen(true);
    },
    [dialogStates],
  );

  const handlePublishConfirm = useCallback(async () => {
    if (dialogStates.pendingPublish !== null) {
      await handlers.handleCoursePublishToggle(dialogStates.pendingPublish);
    }
    dialogStates.setPublishConfirmOpen(false);
    dialogStates.setPendingPublish(null);
  }, [dialogStates, handlers]);

  const handlePublishCancel = useCallback(() => {
    dialogStates.setPublishConfirmOpen(false);
    dialogStates.setPendingPublish(null);
  }, [dialogStates]);

  const handleArchiveToggle = useCallback(
    (checked: boolean) => {
      dialogStates.setPendingArchive(checked);
      dialogStates.setArchiveConfirmOpen(true);
    },
    [dialogStates],
  );

  const handleArchiveConfirm = useCallback(async () => {
    if (dialogStates.pendingArchive !== null) {
      await handlers.handleCourseArchiveToggle(dialogStates.pendingArchive);
    }
    dialogStates.setArchiveConfirmOpen(false);
    dialogStates.setPendingArchive(null);
  }, [dialogStates, handlers]);

  const handleArchiveCancel = useCallback(() => {
    dialogStates.setArchiveConfirmOpen(false);
    dialogStates.setPendingArchive(null);
  }, [dialogStates]);

  const handleEnrollUserWrapper = useCallback(
    async (user: EnrollableUser) => {
      if (!courseId) return;
      await handleEnrollUser(user, courseId, refetchCourse);
    },
    [handleEnrollUser, courseId, refetchCourse],
  );

  const handleAssignmentSave = useCallback(
    async (updatedAssignment: Assignment) => {
      await handlers.handleAssignmentSave(updatedAssignment);
      dialogStates.setEditAssignmentOpen(false);
      dialogStates.setSelectedAssignment(null);
    },
    [handlers, dialogStates],
  );

  useEffect(() => {
    if (!isStudent) {
      void loadTabData(tab as TabType);
    }
  }, [isStudent, loadTabData, tab]);

  if (!course)
    return <LoadingSpinner label="Loading" fullScreen={false} className="min-h-[70vh]" />;

  return (
    <div className="space-y-6 p-0">
      <h1 className="sr-only">
        {course.code}: {course.name}
      </h1>
      <CourseHeader
        course={course}
        isStudent={isStudent}
        onEditClick={() => dialogStates.setEditOpen(true)}
        onDuplicate={openDuplicate}
        onPublishToggle={handlePublishToggle}
        onArchiveToggle={handleArchiveToggle}
      />

      {isStudent ? (
        <StudentCourseView course={course} />
      ) : (
        <AdminCourseView
          course={course}
          tab={tab}
          isAssignmentsLoading={tab === 'assignments' && !isStudent && loadingSections.assignments}
          isProblemsLoading={tab === 'problems' && !isStudent && loadingSections.problems}
          isRosterLoading={tab === 'roster' && !isStudent && loadingSections.roster}
          onTabChange={(value) => {
            handleTabChange(value);
            void loadTabData(value as TabType);
          }}
          onCreateAssignment={() => dialogStates.setCreateAssignmentOpen(true)}
          onCreateProblem={() => dialogStates.setProblemOpen(true)}
          onEnrollUser={openEnrollDialog}
          onBulkEnroll={openBulkEnrollDialog}
          onAssignmentEdit={handleAssignmentEditClick}
          onAssignmentDelete={handleAssignmentDeleteClick}
          onAssignmentPublishToggle={handlers.handleAssignmentPublishToggle}
          onProblemEdit={handleProblemEditClick}
          onProblemDelete={handleProblemDeleteClick}
          onRefreshCourse={refetchCourse}
        />
      )}

      {!isStudent && (
        <CourseDialogs
          course={course}
          timeZone={timezone}
          editOpen={dialogStates.editOpen}
          setEditOpen={dialogStates.setEditOpen}
          onCourseSave={handlers.handleCourseSave}
          problemOpen={dialogStates.problemOpen}
          setProblemOpen={dialogStates.setProblemOpen}
          editProblemOpen={dialogStates.editProblemOpen}
          setEditProblemOpen={dialogStates.setEditProblemOpen}
          selectedProblem={dialogStates.selectedProblem}
          setSelectedProblem={dialogStates.setSelectedProblem}
          onProblemCreated={handlers.handleProblemCreated}
          onProblemSaved={handlers.handleProblemSaved}
          editAssignmentOpen={dialogStates.editAssignmentOpen}
          setEditAssignmentOpen={dialogStates.setEditAssignmentOpen}
          selectedAssignment={dialogStates.selectedAssignment}
          createAssignmentOpen={dialogStates.createAssignmentOpen}
          setCreateAssignmentOpen={dialogStates.setCreateAssignmentOpen}
          onAssignmentSave={handleAssignmentSave}
          onAssignmentCreate={handlers.handleAssignmentCreate}
          confirmOpen={dialogStates.confirmOpen}
          pendingDelete={dialogStates.pendingDelete}
          onConfirm={handleConfirm}
          onCancel={handleCancel}
          publishConfirmOpen={dialogStates.publishConfirmOpen}
          pendingPublish={dialogStates.pendingPublish}
          onPublishConfirm={handlePublishConfirm}
          onPublishCancel={handlePublishCancel}
          archiveConfirmOpen={dialogStates.archiveConfirmOpen}
          pendingArchive={dialogStates.pendingArchive}
          onArchiveConfirm={handleArchiveConfirm}
          onArchiveCancel={handleArchiveCancel}
          enrollOpen={dialogStates.enrollOpen}
          setEnrollOpen={dialogStates.setEnrollOpen}
          allUsers={allUsers}
          onEnrollUser={handleEnrollUserWrapper}
          bulkEnrollOpen={bulkEnrollOpen}
          setBulkEnrollOpen={setBulkEnrollOpen}
        />
      )}

      {!isStudent && (
        <DuplicateCourseDialog
          open={duplicateOpen}
          setOpen={setDuplicateOpen}
          course={course}
          timeZone={timezone}
          onSuccess={(newId) => {
            router.push(`/dashboard/courses/${newId}`);
          }}
        />
      )}
    </div>
  );
}
