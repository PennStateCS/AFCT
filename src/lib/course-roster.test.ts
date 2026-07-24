import { describe, it, expect } from 'vitest';
import {
  getEnrolledIds,
  getInstructors,
  getTAs,
  getStudents,
  getStudentCount,
  formatInstructorNames,
  sortRoster,
  type EnrolledUser,
} from './course-roster';

describe('course-roster', () => {
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

    it('should include all FACULTY courseRole instructors regardless of global role', () => {
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

      expect(result).toBe('John Doe, Jane Smith');
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