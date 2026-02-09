import { describe, it, expect, vi, beforeEach } from 'vitest';
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
  getEnrolledIds,
  isEnrolled,
  getInstructors,
  getTAs,
  getStudents,
  getStudentCount,
  formatInstructorNames,
  deriveRoleSlices,
  sortRoster,
} from './course-utils';
import type { FullCourse, DeleteTarget } from '@/types/course';
import type { Assignment, Problem, Course } from '@prisma/client';
import type { EnrolledUser } from './course-utils';

// Mock global fetch
global.fetch = vi.fn();

describe('course-utils', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('deleteItem', () => {
    it('should delete an assignment successfully', async () => {
      const mockFetch = vi.mocked(fetch);
      mockFetch.mockResolvedValueOnce({
        ok: true,
      } as Response);

      const target: DeleteTarget = { type: 'assignment', id: 'assignment-1' };
      await deleteItem(target);

      expect(mockFetch).toHaveBeenCalledWith('/api/assignments/assignment-1', { method: 'DELETE' });
    });

    it('should delete a problem successfully', async () => {
      const mockFetch = vi.mocked(fetch);
      mockFetch.mockResolvedValueOnce({
        ok: true,
      } as Response);

      const target: DeleteTarget = { type: 'problem', id: 'problem-1' };
      await deleteItem(target);

      expect(mockFetch).toHaveBeenCalledWith('/api/problems/problem-1', { method: 'DELETE' });
    });

    it('should throw error when assignment deletion fails with JSON error', async () => {
      const mockFetch = vi.mocked(fetch);
      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: 'Assignment not found' }),
      } as Response);

      const target: DeleteTarget = { type: 'assignment', id: 'assignment-1' };
      await expect(deleteItem(target)).rejects.toThrow('Assignment not found');
    });

    it('should throw error when problem deletion fails with message', async () => {
      const mockFetch = vi.mocked(fetch);
      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: async () => ({ message: 'Problem has submissions' }),
      } as Response);

      const target: DeleteTarget = { type: 'problem', id: 'problem-1' };
      await expect(deleteItem(target)).rejects.toThrow('Problem has submissions');
    });

    it('should throw default error when deletion fails without JSON body', async () => {
      const mockFetch = vi.mocked(fetch);
      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: async () => {
          throw new Error('Invalid JSON');
        },
      } as Response);

      const target: DeleteTarget = { type: 'assignment', id: 'assignment-1' };
      await expect(deleteItem(target)).rejects.toThrow('Failed to delete assignment');
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
        { id: 'problem-1', name: 'Problem 1' } as Problem,
        { id: 'problem-2', name: 'Problem 2' } as Problem,
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
      } as Assignment;

      const result = updateCourseAfterAssignmentSave(mockCourse, updatedAssignment);

      expect(result.assignments[0].name).toBe('New Name');
      expect(result.assignments[0].problemCount).toBe(3); // preserved
      expect(result.assignments[1].name).toBe('Assignment 2'); // unchanged
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
          { id: 'problem-1', name: 'Old Problem' } as Problem,
          { id: 'problem-2', name: 'Problem 2' } as Problem,
        ],
      } as FullCourse;

      const updatedProblem: Problem = {
        id: 'problem-1',
        name: 'Updated Problem',
      } as Problem;

      const result = updateCourseAfterProblemSave(mockCourse, updatedProblem);

      expect(result.problems[0].name).toBe('Updated Problem');
      expect(result.problems[1].name).toBe('Problem 2');
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
      } as Assignment;

      const result = updateCourseAfterAssignmentCreate(mockCourse, newAssignment);

      expect(result.assignments).toHaveLength(2);
      expect(result.assignments[1].id).toBe('assignment-2');
      expect(result.assignments[1].problemCount).toBe(0);
    });
  });

  describe('updateCourseAfterProblemCreate', () => {
    it('should add new problem to course', () => {
      const mockCourse: FullCourse = {
        problems: [{ id: 'problem-1', name: 'Problem 1' } as Problem],
      } as FullCourse;

      const newProblem: Problem = {
        id: 'problem-2',
        name: 'New Problem',
      } as Problem;

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

      await updateAssignmentPublishStatus('assignment-1', true);

      expect(mockFetch).toHaveBeenCalledWith('/api/assignments/assignment-1', {
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

      await expect(updateAssignmentPublishStatus('assignment-1', true)).rejects.toThrow(
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

  describe('getEnrolledIds', () => {
    it('should extract IDs from EnrolledUser objects', () => {
      const enrolled: EnrolledUser[] = [
        { id: 'user-1', email: 'user1@test.com' },
        { id: 'user-2', email: 'user2@test.com' },
      ];

      const result = getEnrolledIds(enrolled);

      expect(result).toEqual(['user-1', 'user-2']);
    });

    it('should handle string array', () => {
      const enrolled = ['user-1', 'user-2'];
      const result = getEnrolledIds(enrolled);

      expect(result).toEqual(['user-1', 'user-2']);
    });

    it('should return empty array for undefined', () => {
      const result = getEnrolledIds(undefined);
      expect(result).toEqual([]);
    });

    it('should handle mixed string and EnrolledUser array', () => {
      const enrolled: (string | EnrolledUser)[] = [
        'user-1',
        { id: 'user-2', email: 'user2@test.com' },
      ];

      const result = getEnrolledIds(enrolled);

      expect(result).toEqual(['user-1', 'user-2']);
    });
  });

  describe('isEnrolled', () => {
    it('should return true if user is enrolled', () => {
      const enrolled: EnrolledUser[] = [
        { id: 'user-1', email: 'user1@test.com' },
        { id: 'user-2', email: 'user2@test.com' },
      ];

      expect(isEnrolled(enrolled, 'user-1')).toBe(true);
    });

    it('should return false if user is not enrolled', () => {
      const enrolled: EnrolledUser[] = [{ id: 'user-1', email: 'user1@test.com' }];

      expect(isEnrolled(enrolled, 'user-3')).toBe(false);
    });

    it('should return false for undefined enrolled list', () => {
      expect(isEnrolled(undefined, 'user-1')).toBe(false);
    });
  });

  describe('getInstructors', () => {
    it('should filter users with FACULTY courseRole', () => {
      const enrolled: EnrolledUser[] = [
        { id: 'user-1', courseRole: 'FACULTY', firstName: 'John' },
        { id: 'user-2', courseRole: 'STUDENT', firstName: 'Jane' },
        { id: 'user-3', courseRole: 'FACULTY', firstName: 'Bob' },
      ];

      const result = getInstructors(enrolled);

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('user-1');
      expect(result[1].id).toBe('user-3');
    });

    it('should return empty array for undefined', () => {
      expect(getInstructors(undefined)).toEqual([]);
    });
  });

  describe('getTAs', () => {
    it('should filter users with TA courseRole', () => {
      const enrolled: EnrolledUser[] = [
        { id: 'user-1', courseRole: 'TA', firstName: 'John' },
        { id: 'user-2', courseRole: 'STUDENT', firstName: 'Jane' },
        { id: 'user-3', courseRole: 'TA', firstName: 'Bob' },
      ];

      const result = getTAs(enrolled);

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('user-1');
      expect(result[1].id).toBe('user-3');
    });

    it('should return empty array for undefined', () => {
      expect(getTAs(undefined)).toEqual([]);
    });
  });

  describe('getStudents', () => {
    it('should filter users with STUDENT courseRole', () => {
      const enrolled: EnrolledUser[] = [
        { id: 'user-1', courseRole: 'STUDENT', firstName: 'John' },
        { id: 'user-2', courseRole: 'FACULTY', firstName: 'Jane' },
        { id: 'user-3', courseRole: 'STUDENT', firstName: 'Bob' },
      ];

      const result = getStudents(enrolled);

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('user-1');
      expect(result[1].id).toBe('user-3');
    });

    it('should use global role if courseRole is undefined', () => {
      const enrolled: EnrolledUser[] = [
        { id: 'user-1', role: 'STUDENT', firstName: 'John' },
        { id: 'user-2', role: 'FACULTY', firstName: 'Jane' },
      ];

      const result = getStudents(enrolled);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('user-1');
    });

    it('should return empty array for undefined', () => {
      expect(getStudents(undefined)).toEqual([]);
    });
  });

  describe('getStudentCount', () => {
    it('should return count of students', () => {
      const enrolled: EnrolledUser[] = [
        { id: 'user-1', courseRole: 'STUDENT' },
        { id: 'user-2', courseRole: 'FACULTY' },
        { id: 'user-3', courseRole: 'STUDENT' },
      ];

      expect(getStudentCount(enrolled)).toBe(2);
    });

    it('should return 0 for undefined', () => {
      expect(getStudentCount(undefined)).toBe(0);
    });
  });

  describe('formatInstructorNames', () => {
    it('should format instructor names as comma-separated list', () => {
      const enrolled: EnrolledUser[] = [
        {
          id: 'user-1',
          courseRole: 'FACULTY',
          firstName: 'John',
          lastName: 'Doe',
          role: 'FACULTY',
        },
        { id: 'user-2', courseRole: 'STUDENT', firstName: 'Jane', lastName: 'Smith' },
        {
          id: 'user-3',
          courseRole: 'FACULTY',
          firstName: 'Bob',
          lastName: 'Johnson',
          role: 'FACULTY',
        },
      ];

      const result = formatInstructorNames(enrolled);

      expect(result).toBe('John Doe, Bob Johnson');
    });

    it('should exclude ADMIN role instructors', () => {
      const enrolled: EnrolledUser[] = [
        { id: 'user-1', courseRole: 'FACULTY', firstName: 'John', lastName: 'Doe', role: 'ADMIN' },
        {
          id: 'user-2',
          courseRole: 'FACULTY',
          firstName: 'Jane',
          lastName: 'Smith',
          role: 'FACULTY',
        },
      ];

      const result = formatInstructorNames(enrolled);

      expect(result).toBe('Jane Smith');
    });

    it('should return TBA when no instructors', () => {
      const enrolled: EnrolledUser[] = [
        { id: 'user-1', courseRole: 'STUDENT', firstName: 'John', lastName: 'Doe' },
      ];

      const result = formatInstructorNames(enrolled);

      expect(result).toBe('TBA');
    });

    it('should handle instructors with missing names', () => {
      const enrolled: EnrolledUser[] = [
        { id: 'user-1', courseRole: 'FACULTY', firstName: 'John', role: 'FACULTY' },
        { id: 'user-2', courseRole: 'FACULTY', lastName: 'Smith', role: 'FACULTY' },
      ];

      const result = formatInstructorNames(enrolled);

      expect(result).toBe('John, Smith');
    });

    it('should return TBA for undefined', () => {
      expect(formatInstructorNames(undefined)).toBe('TBA');
    });
  });

  describe('deriveRoleSlices', () => {
    it('should categorize users by role with counts', () => {
      const enrolled: EnrolledUser[] = [
        { id: 'user-1', courseRole: 'FACULTY' },
        { id: 'user-2', courseRole: 'FACULTY' },
        { id: 'user-3', courseRole: 'TA' },
        { id: 'user-4', courseRole: 'STUDENT' },
        { id: 'user-5', courseRole: 'STUDENT' },
        { id: 'user-6', courseRole: 'STUDENT' },
      ];

      const result = deriveRoleSlices(enrolled);

      expect(result.instructors).toHaveLength(2);
      expect(result.tas).toHaveLength(1);
      expect(result.students).toHaveLength(3);
      expect(result.counts).toEqual({
        instructors: 2,
        tas: 1,
        students: 3,
      });
    });

    it('should handle empty roster', () => {
      const result = deriveRoleSlices([]);

      expect(result.counts).toEqual({
        instructors: 0,
        tas: 0,
        students: 0,
      });
    });

    it('should handle undefined roster', () => {
      const result = deriveRoleSlices(undefined);

      expect(result.counts).toEqual({
        instructors: 0,
        tas: 0,
        students: 0,
      });
    });
  });

  describe('sortRoster', () => {
    it('should sort by courseRole priority then lastName', () => {
      const enrolled: EnrolledUser[] = [
        { id: 'user-1', courseRole: 'STUDENT', lastName: 'Smith' },
        { id: 'user-2', courseRole: 'FACULTY', lastName: 'Doe' },
        { id: 'user-3', courseRole: 'TA', lastName: 'Johnson' },
        { id: 'user-4', courseRole: 'FACULTY', lastName: 'Anderson' },
        { id: 'user-5', courseRole: 'STUDENT', lastName: 'Brown' },
      ];

      const result = sortRoster(enrolled);

      expect(result[0].id).toBe('user-4'); // FACULTY Anderson
      expect(result[1].id).toBe('user-2'); // FACULTY Doe
      expect(result[2].id).toBe('user-3'); // TA Johnson
      expect(result[3].id).toBe('user-5'); // STUDENT Brown
      expect(result[4].id).toBe('user-1'); // STUDENT Smith
    });

    it('should use global role when courseRole is undefined', () => {
      const enrolled: EnrolledUser[] = [
        { id: 'user-1', role: 'STUDENT', lastName: 'Smith' },
        { id: 'user-2', role: 'FACULTY', lastName: 'Doe' },
      ];

      const result = sortRoster(enrolled);

      expect(result[0].id).toBe('user-2'); // FACULTY
      expect(result[1].id).toBe('user-1'); // STUDENT
    });

    it('should handle users without lastName', () => {
      const enrolled: EnrolledUser[] = [
        { id: 'user-1', courseRole: 'STUDENT' },
        { id: 'user-2', courseRole: 'STUDENT', lastName: 'Smith' },
      ];

      const result = sortRoster(enrolled);

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('user-1'); // empty lastName comes first
    });

    it('should return empty array for undefined', () => {
      expect(sortRoster(undefined)).toEqual([]);
    });

    it('should not mutate original array', () => {
      const enrolled: EnrolledUser[] = [
        { id: 'user-1', courseRole: 'STUDENT', lastName: 'Smith' },
        { id: 'user-2', courseRole: 'FACULTY', lastName: 'Doe' },
      ];

      const original = [...enrolled];
      sortRoster(enrolled);

      expect(enrolled).toEqual(original);
    });
  });
});
