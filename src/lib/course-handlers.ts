import { useCallback } from 'react';
import { showToast } from '@/lib/toast';
import { FullCourse, DeleteTarget } from '@/types/course';
import { Assignment, Problem, Course } from '@prisma/client';
import {
  deleteItem,
  updateCourseAfterDelete,
  updateCourseAfterAssignmentSave,
  updateCourseAfterAssignmentPublish,
  updateCourseAfterProblemSave,
  updateCourseAfterAssignmentCreate,
  updateCourseAfterProblemCreate,
  updateAssignmentPublishStatus,
  updateCoursePublishStatus,
  updateCourseArchiveStatus,
  saveCourse,
} from '@/lib/course-utils';

export function useCourseHandlers(
  course: FullCourse | null,
  setCourse: React.Dispatch<React.SetStateAction<FullCourse | null>>
) {
  // Assignment handlers
  const handleAssignmentEditClick = useCallback((assignment: Assignment) => {
    return assignment;
  }, []);

  const handleAssignmentDeleteClick = useCallback((assignmentId: string) => {
    return assignmentId;
  }, []);

  const handleAssignmentSave = useCallback(async (updatedAssignment: Assignment) => {
    if (!course) return;
    setCourse(updateCourseAfterAssignmentSave(course, updatedAssignment));
    showToast.success('Assignment updated!');
  }, [course, setCourse]);

  const handleAssignmentPublishToggle = useCallback(async (assignmentId: string, newValue: boolean) => {
    if (!course) return;
    
    try {
      await updateAssignmentPublishStatus(assignmentId, newValue);
      setCourse(updateCourseAfterAssignmentPublish(course, assignmentId, newValue));
      showToast.success(`Assignment ${newValue ? 'published' : 'unpublished'} successfully!`);
    } catch (error: any) {
      const msg = error?.message || 'Unknown Error: Failed to update assignment status';
      showToast.error(msg);
      console.error('Error updating assignment:', error);
    }
  }, [course, setCourse]);

  const handleAssignmentCreate = useCallback((newAssignment: Assignment) => {
    if (!course) return;
    setCourse(updateCourseAfterAssignmentCreate(course, newAssignment));
    showToast.success('Assignment created!');
  }, [course, setCourse]);

  // Problem handlers
  const handleProblemEditClick = useCallback((problem: Problem) => {
    return problem;
  }, []);

  const handleProblemDeleteClick = useCallback((problemId: string) => {
    return problemId;
  }, []);

  const handleProblemCreated = useCallback((newProblem?: Problem) => {
    if (!course || !newProblem) return;
    setCourse(updateCourseAfterProblemCreate(course, newProblem));
    showToast.success('Problem created!');
  }, [course, setCourse]);

  const handleProblemSaved = useCallback((updatedProblem?: Problem) => {
    if (!course || !updatedProblem) return;
    setCourse(updateCourseAfterProblemSave(course, updatedProblem));
    showToast.success('Problem updated!');
  }, [course, setCourse]);

  // Delete handler
  const handleDelete = useCallback(async (target: DeleteTarget) => {
    if (!course) return;
    
    try {
      await deleteItem(target);
      setCourse(updateCourseAfterDelete(course, target));
      showToast.success(target.type === 'assignment' ? 'Assignment deleted' : 'Problem deleted');
    } catch (err) {
      showToast.error('Error deleting item');
      console.error(err);
    }
  }, [course, setCourse]);

  // Course save handler
  const handleCourseSave = useCallback(async (updatedCourse: Partial<Course>) => {
    if (!course) return;
    try {
      const fullCourse = { ...course, ...updatedCourse };
      const updated = await saveCourse(fullCourse);
      setCourse((prev) => (prev ? { ...prev, ...updated } : prev));
      showToast.success('Course updated!');
    } catch {
      showToast.error('Failed to save course');
    }
  }, [course, setCourse]);

  // Course publish handler
  const handleCoursePublishToggle = useCallback(async (isPublished: boolean) => {
    if (!course) return;
    
    try {
      const updated = await updateCoursePublishStatus(course.id, isPublished);
      setCourse((prev) => (prev ? { ...prev, isPublished: updated.isPublished } : prev));
      showToast.success(isPublished ? 'Course published' : 'Course unpublished');
    } catch (error: any) {
      const msg = error?.message || 'Failed to archive course';
      showToast.error(msg);
    }
  }, [course, setCourse]);

  // Course archive handler
const handleCourseArchiveToggle = useCallback(async (isArchived: boolean) => {
    if (!course) return;

        
    try {
      const updated = await updateCourseArchiveStatus(course.id, course.startDate, course.endDate, isArchived);
      setCourse((prev) => (prev ? { ...prev, isArchived: updated.isArchived } : prev));
      showToast.success(isArchived ? 'Course archived' : 'Course unarchived');
    } catch (error: any) {
      const msg = error?.message || 'Failed to archive course';
      showToast.error(msg);
    }
  }, [course, setCourse]);

  return {
    handleAssignmentEditClick,
    handleAssignmentDeleteClick,
    handleAssignmentSave,
    handleAssignmentPublishToggle,
    handleAssignmentCreate,

    handleProblemEditClick,
    handleProblemDeleteClick,
    handleProblemCreated,
    handleProblemSaved,

    handleDelete,
    handleCourseSave,
    handleCoursePublishToggle,
    handleCourseArchiveToggle,
  };
}
