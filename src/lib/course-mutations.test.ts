import { describe, it, expect, vi } from 'vitest';
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
} from './course-mutations';
import type { FullCourse, DeleteTarget } from '@/types/course';
import type { Assignment, Problem, Course } from '@prisma/client';

// Mock global fetch
global.fetch = vi.fn();

describe('course-mutations', () => {
  describe('deleteItem', () => {
    it('should delete an assignment successfully', async () => {
      const mockFetch = vi.mocked(fetch);
      mockFetch.mockResolvedValueOnce({
        ok: true,
      } as Response);

      const target: DeleteTarget = { type: 'assignment', id: 'assignment-1' };
      await deleteItem(target, 'course-1');

      expect(mockFetch).toHaveBeenCalledWith('/api/courses/course-1/assignments/assignment-1', {
        method: 'DELETE',
      });
    });

    it('should delete a problem successfully', async () => {
      const mockFetch = vi.mocked(fetch);
      mockFetch.mockResolvedValueOnce({
        ok: true,
      } as Response);

      const target: DeleteTarget = { type: 'problem', id: 'problem-1' };
      await deleteItem(target, 'course-1');

      expect(mockFetch).toHaveBeenCalledWith('/api/courses/course-1/problems/problem-1', {
        method: 'DELETE',
      });
    });

    it('should throw error when assignment deletion fails with JSON error', async () => {
      const mockFetch = vi.mocked(fetch);
      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: 'Assignment not found' }),
      } as Response);

      const target: DeleteTarget = { type: 'assignment', id: 'assignment-1' };
      await expect(deleteItem(target, 'course-1')).rejects.toThrow('Assignment not found');
    });

    it('should throw error when problem deletion fails with message', async () => {
      const mockFetch = vi.mocked(fetch);
      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: async () => ({ message: 'Problem has submissions' }),
      } as Response);

      const target: DeleteTarget = { type: 'problem', id: 'problem-1' };
      await expect(deleteItem(target, 'course-1')).rejects.toThrow('Problem has submissions');
    });

    it('should throw default error when deletion fails without JSON body', async () => {
      const mockFetch = vi.mocked(fetch);
      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: async () => {
          throw new Error('Invalid JSON');
        },
      } as unknown as Response);

      const target: DeleteTarget = { type: 'assignment', id: 'assignment-1' };
      await expect(deleteItem(target, 'course-1')).rejects.toThrow('Failed to delete assignment');
    });
  });

  describe('updateCourseAfterDelete', () => {
    const mockCourse: FullCourse = {
      id: 'course-1',
      name: 'Test Course',
      isArchived: false,
      isPublished: true,
      startDate: new Date('2024-01-01'),
      endDate: new Date('2024-12-31'),
      assignments: [
        { id: 'assignment-1', name: 'Assignment 1', problemCount: 3 } as any,
        { id: 'assignment-2', name: 'Assignment 2', problemCount: 2 } as any,
      ],
      problems: [
        { id: 'problem-1', name: 'Problem 1' } as unknown as Problem,
        { id: 'problem-2', name: 'Problem 2' } as unknown as Problem,
      ],
    } as FullCourse;

    it('should remove deleted assignment from course', () => {
      const target: DeleteTarget = { type: 'assignment', id: 'assignment-1' };
      const result = updateCourseAfterDelete(mockCourse, target);

      expect(result.assignments).toHaveLength(1);
      expect(result.assignments[0].id).toBe('assignment-2');
    });

    it('should remove deleted problem from course', () => {
      const target: DeleteTarget = { type: 'problem', id: 'problem-1' };
      const result = updateCourseAfterDelete(mockCourse, target);

      expect(result.problems).toHaveLength(1);
      expect(result.problems[0].id).toBe('problem-2');
    });

    it('should return unchanged course for unknown target type', () => {
      const target: DeleteTarget = { type: 'unknown' as any, id: 'id-1' };
      const result = updateCourseAfterDelete(mockCourse, target);

      expect(result).toEqual(mockCourse);
    });
  });

  describe('updateCourseAfterAssignmentSave', () => {
    it('should update an existing assignment in the course', () => {
      const mockCourse: FullCourse = {
        assignments: [
          { id: 'assignment-1', name: 'Old Name', problemCount: 3 } as any,
          { id: 'assignment-2', name: 'Assignment 2', problemCount: 2 } as any,
        ],
      } as FullCourse;

      const updatedAssignment: Assignment = {
        id: 'assignment-1',
        name: 'New Name',
      } as unknown as Assignment;

      const result = updateCourseAfterAssignmentSave(mockCourse, updatedAssignment);

      expect((result.assignments[0] as unknown as { name: string }).name).toBe('New Name');
      expect(result.assignments[0].problemCount).toBe(3); // preserved
      expect((result.assignments[1] as unknown as { name: string }).name).toBe('Assignment 2'); // unchanged
    });
  });

  describe('updateCourseAfterAssignmentPublish', () => {
    it('should update assignment publish status to true', () => {
      const mockCourse: FullCourse = {
        assignments: [
          { id: 'assignment-1', isPublished: false } as any,
          { id: 'assignment-2', isPublished: true } as any,
        ],
      } as FullCourse;

      const result = updateCourseAfterAssignmentPublish(mockCourse, 'assignment-1', true);

      expect(result.assignments[0].isPublished).toBe(true);
      expect(result.assignments[1].isPublished).toBe(true);
    });

    it('should update assignment publish status to false', () => {
      const mockCourse: FullCourse = {
        assignments: [{ id: 'assignment-1', isPublished: true } as any],
      } as FullCourse;

      const result = updateCourseAfterAssignmentPublish(mockCourse, 'assignment-1', false);

      expect(result.assignments[0].isPublished).toBe(false);
    });
  });

  describe('updateCourseAfterProblemSave', () => {
    it('should update an existing problem in the course', () => {
      const mockCourse: FullCourse = {
        problems: [
          { id: 'problem-1', name: 'Old Problem' } as unknown as Problem,
          { id: 'problem-2', name: 'Problem 2' } as unknown as Problem,
        ],
      } as FullCourse;

      const updatedProblem: Problem = {
        id: 'problem-1',
        name: 'Updated Problem',
      } as unknown as Problem;

      const result = updateCourseAfterProblemSave(mockCourse, updatedProblem);

      expect((result.problems[0] as unknown as { name: string }).name).toBe('Updated Problem');
      expect((result.problems[1] as unknown as { name: string }).name).toBe('Problem 2');
    });
  });

  describe('updateCourseAfterAssignmentCreate', () => {
    it('should add new assignment with problemCount 0', () => {
      const mockCourse: FullCourse = {
        assignments: [{ id: 'assignment-1', name: 'Assignment 1' } as any],
      } as FullCourse;

      const newAssignment: Assignment = {
        id: 'assignment-2',
        name: 'New Assignment',
      } as unknown as Assignment;

      const result = updateCourseAfterAssignmentCreate(mockCourse, newAssignment);

      expect(result.assignments).toHaveLength(2);
      expect(result.assignments[1].id).toBe('assignment-2');
      expect(result.assignments[1].problemCount).toBe(0);
    });
  });

  describe('updateCourseAfterProblemCreate', () => {
    it('should add new problem to course', () => {
      const mockCourse: FullCourse = {
        problems: [{ id: 'problem-1', name: 'Problem 1' } as unknown as Problem],
      } as FullCourse;

      const newProblem: Problem = {
        id: 'problem-2',
        name: 'New Problem',
      } as unknown as Problem;

      const result = updateCourseAfterProblemCreate(mockCourse, newProblem);

      expect(result.problems).toHaveLength(2);
      expect(result.problems[1].id).toBe('problem-2');
    });
  });

  describe('updateAssignmentPublishStatus', () => {
    it('should publish an assignment successfully', async () => {
      const mockFetch = vi.mocked(fetch);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      } as Response);

      await updateAssignmentPublishStatus('course-1', 'assignment-1', true);

      expect(mockFetch).toHaveBeenCalledWith('/api/courses/course-1/assignments/assignment-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isPublished: true }),
      });
    });

    it('should throw error when publishing fails', async () => {
      const mockFetch = vi.mocked(fetch);
      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: 'Permission denied' }),
      } as Response);

      await expect(updateAssignmentPublishStatus('course-1', 'assignment-1', true)).rejects.toThrow(
        'Permission denied',
      );
    });
  });

  describe('updateCoursePublishStatus', () => {
    it('should publish a course successfully', async () => {
      const mockCourse = { id: 'course-1', isPublished: true };
      const mockFetch = vi.mocked(fetch);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockCourse,
      } as Response);

      const result = await updateCoursePublishStatus('course-1', true);

      expect(mockFetch).toHaveBeenCalledWith('/api/courses/course-1/publish', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isPublished: true }),
      });
      expect(result).toEqual(mockCourse);
    });

    it('should unpublish a course successfully', async () => {
      const mockCourse = { id: 'course-1', isPublished: false };
      const mockFetch = vi.mocked(fetch);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockCourse,
      } as Response);

      const result = await updateCoursePublishStatus('course-1', false);

      expect(result.isPublished).toBe(false);
    });

    it('should throw error when publish fails with JSON message', async () => {
      const mockFetch = vi.mocked(fetch);
      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: async () => ({ message: 'Course has active students' }),
      } as Response);

      await expect(updateCoursePublishStatus('course-1', false)).rejects.toThrow(
        'Course has active students',
      );
    });
  });

  describe('updateCourseArchiveStatus', () => {
    it('should archive a course successfully', async () => {
      const mockCourse = { id: 'course-1', isArchived: true };
      const startDate = new Date('2024-01-01');
      const endDate = new Date('2024-12-31');
      const mockFetch = vi.mocked(fetch);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockCourse,
      } as Response);

      const result = await updateCourseArchiveStatus('course-1', startDate, endDate, true);

      expect(mockFetch).toHaveBeenCalledWith('/api/courses/course-1/archive', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isArchived: true, startDate, endDate }),
      });
      expect(result).toEqual(mockCourse);
    });

    it('should throw error when archive fails', async () => {
      const mockFetch = vi.mocked(fetch);
      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: 'Course in session' }),
      } as Response);

      await expect(
        updateCourseArchiveStatus('course-1', new Date(), new Date(), true),
      ).rejects.toThrow('Course in session');
    });
  });

  describe('saveCourse', () => {
    it('should save a course successfully', async () => {
      const mockCourse = { id: 'course-1', name: 'Updated Course' } as Course;
      const mockFetch = vi.mocked(fetch);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockCourse,
      } as Response);

      const result = await saveCourse(mockCourse);

      expect(mockFetch).toHaveBeenCalledWith('/api/courses/course-1', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(mockCourse),
      });
      expect(result).toEqual(mockCourse);
    });

    it('should throw error when save fails', async () => {
      const mockCourse = { id: 'course-1', name: 'Test' } as Course;
      const mockFetch = vi.mocked(fetch);
      mockFetch.mockResolvedValueOnce({
        ok: false,
      } as Response);

      await expect(saveCourse(mockCourse)).rejects.toThrow('Failed to save course');
    });
  });
});