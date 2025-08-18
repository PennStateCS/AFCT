'use client';

import { useCallback } from 'react';
import { useParams } from 'next/navigation';
import { useSession } from 'next-auth/react';

// Types
import { EnrollableUser } from './types';
import { Assignment, Problem } from '@prisma/client';

// Hooks
import { useCourseData, useTabNavigation, useDialogStates, useEnrollment } from './hooks';
import { useCourseHandlers } from './handlers';

// Components
import { CourseHeader } from './components/CourseHeader';
import { StudentCourseView } from './components/StudentCourseView';
import { AdminCourseView } from './components/AdminCourseView';
import { CourseDialogs } from './components/CourseDialogs';

export default function AdminCoursePage() {
  const { id } = useParams();
  const { data: session } = useSession();
  const courseId = Array.isArray(id) ? id[0] : id;
  
  // Check if user is a student (vs admin/faculty/TA)
  const isStudent = session?.user?.role === 'STUDENT';

  // Data fetching
  const { course, setCourse, refetchCourse } = useCourseData(courseId || '');
  
  // Tab navigation (admin only)
  const { tab, handleTabChange } = useTabNavigation();
  
  // Dialog states
  const dialogStates = useDialogStates();
  
  // Enrollment
  const { allUsers, fetchAvailableUsers, handleEnrollUser } = useEnrollment(course);
  
  // Event handlers
  const handlers = useCourseHandlers(course, setCourse);

  // Enrollment dialog opener
  const openEnrollDialog = useCallback(async () => {
    await fetchAvailableUsers();
    dialogStates.setAllUsers(allUsers);
    dialogStates.setEnrollOpen(true);
  }, [fetchAvailableUsers, allUsers, dialogStates]);

  // Problem handlers with dialog state
  const handleProblemEditClick = useCallback((problem: Problem) => {
    dialogStates.setSelectedProblem(problem);
    dialogStates.setEditProblemOpen(true);
  }, [dialogStates]);

  const handleProblemDeleteClick = useCallback((problemId: string) => {
    dialogStates.setPendingDelete({ id: problemId, type: 'problem' });
    dialogStates.setConfirmOpen(true);
  }, [dialogStates]);

  // Assignment handlers with dialog state
  const handleAssignmentEditClick = useCallback((assignment: Assignment) => {
    dialogStates.setSelectedAssignment(assignment);
    dialogStates.setEditAssignmentOpen(true);
  }, [dialogStates]);

  const handleAssignmentDeleteClick = useCallback((assignmentId: string) => {
    dialogStates.setPendingDelete({ id: assignmentId, type: 'assignment' });
    dialogStates.setConfirmOpen(true);
  }, [dialogStates]);

  // Confirm handlers
  const handleConfirm = useCallback(() => {
    if (dialogStates.pendingDelete) {
      handlers.handleDelete(dialogStates.pendingDelete);
    }
    dialogStates.setConfirmOpen(false);
    dialogStates.setPendingDelete(null);
  }, [dialogStates, handlers]);

  const handleCancel = useCallback(() => {
    dialogStates.setPendingDelete(null);
    dialogStates.setConfirmOpen(false);
  }, [dialogStates]);

  // Publish handlers
  const handlePublishToggle = useCallback((checked: boolean) => {
    dialogStates.setPendingPublish(checked);
    dialogStates.setPublishConfirmOpen(true);
  }, [dialogStates]);

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

  // Enrollment handler
  const handleEnrollUserWrapper = useCallback(async (user: EnrollableUser) => {
    if (!courseId) return;
    await handleEnrollUser(user, courseId, refetchCourse);
  }, [handleEnrollUser, courseId, refetchCourse]);

  // Assignment save handler
  const handleAssignmentSave = useCallback(async (updatedAssignment: Assignment) => {
    await handlers.handleAssignmentSave(updatedAssignment);
    dialogStates.setEditAssignmentOpen(false);
    dialogStates.setSelectedAssignment(null);
  }, [handlers, dialogStates]);

  if (!course) return <div className="p-6">Loading course...</div>;

  return (
    <div className="space-y-6 p-0">
      {/* Course Header */}
      <CourseHeader
        course={course}
        isStudent={isStudent}
        onEditClick={() => dialogStates.setEditOpen(true)}
        onPublishToggle={handlePublishToggle}
      />

      {/* Main Content */}
      {isStudent ? (
        <StudentCourseView course={course} />
      ) : (
        <AdminCourseView
          course={course}
          tab={tab}
          onTabChange={handleTabChange}
          onCreateAssignment={() => dialogStates.setCreateAssignmentOpen(true)}
          onCreateProblem={() => dialogStates.setProblemOpen(true)}
          onEnrollUser={openEnrollDialog}
          onAssignmentEdit={handleAssignmentEditClick}
          onAssignmentDelete={handleAssignmentDeleteClick}
          onAssignmentPublishToggle={handlers.handleAssignmentPublishToggle}
          onProblemEdit={handleProblemEditClick}
          onProblemDelete={handleProblemDeleteClick}
          onRefreshCourse={refetchCourse}
        />
      )}

      {/* Dialogs */}
      {!isStudent && (
        <CourseDialogs
          course={course}
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
          enrollOpen={dialogStates.enrollOpen}
          setEnrollOpen={dialogStates.setEnrollOpen}
          allUsers={allUsers}
          onEnrollUser={handleEnrollUserWrapper}
        />
      )}
    </div>
  );
}
