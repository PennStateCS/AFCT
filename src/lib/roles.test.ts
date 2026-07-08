import { describe, it, expect } from 'vitest';
import {
  courseRoleOptions,
  roleOrder,
  roleSortingFn,
  parseCourseRole,
  formatCourseRole,
} from './roles';
import type { Row } from '@tanstack/react-table';

describe('roles', () => {
  describe('courseRoleOptions', () => {
    it('should include all valid course roles', () => {
      expect(courseRoleOptions).toContain('FACULTY');
      expect(courseRoleOptions).toContain('TA');
      expect(courseRoleOptions).toContain('STUDENT');
    });

    it('should be an array', () => {
      expect(Array.isArray(courseRoleOptions)).toBe(true);
    });
  });

  describe('roleOrder', () => {
    it('should define priority for each role', () => {
      expect(roleOrder.FACULTY).toBe(1);
      expect(roleOrder.TA).toBe(2);
      expect(roleOrder.STUDENT).toBe(3);
    });

    it('should have FACULTY as highest priority', () => {
      expect(roleOrder.FACULTY).toBeLessThan(roleOrder.TA);
      expect(roleOrder.FACULTY).toBeLessThan(roleOrder.STUDENT);
    });
  });

  describe('roleSortingFn', () => {
    it('should sort by role priority', () => {
      const facultyRow = {
        getValue: () => 'FACULTY',
        original: { lastName: 'Smith' },
      } as Row<any>;

      const studentRow = {
        getValue: () => 'STUDENT',
        original: { lastName: 'Jones' },
      } as Row<any>;

      const result = roleSortingFn(facultyRow, studentRow, 'role');
      expect(result).toBeLessThan(0); // FACULTY should come before STUDENT
    });

    it('should sort by lastName when roles are the same', () => {
      const row1 = {
        getValue: () => 'STUDENT',
        original: { lastName: 'Brown' },
      } as Row<any>;

      const row2 = {
        getValue: () => 'STUDENT',
        original: { lastName: 'Smith' },
      } as Row<any>;

      const result = roleSortingFn(row1, row2, 'role');
      expect(result).toBeLessThan(0); // Brown should come before Smith
    });

    it('should handle missing lastName', () => {
      const row1 = {
        getValue: () => 'STUDENT',
        original: {},
      } as Row<any>;

      const row2 = {
        getValue: () => 'STUDENT',
        original: { lastName: 'Smith' },
      } as Row<any>;

      const result = roleSortingFn(row1, row2, 'role');
      expect(result).toBeLessThan(0); // Empty should come before Smith
    });

    it('should handle unknown roles with fallback priority', () => {
      const row1 = {
        getValue: () => 'UNKNOWN_ROLE',
        original: { lastName: 'Smith' },
      } as Row<any>;

      const row2 = {
        getValue: () => 'STUDENT',
        original: { lastName: 'Jones' },
      } as Row<any>;

      const result = roleSortingFn(row1, row2, 'role');
      expect(result).toBeGreaterThan(0); // Unknown (99) should come after STUDENT (3)
    });

    it('should return 0 for identical role and lastName', () => {
      const row1 = {
        getValue: () => 'FACULTY',
        original: { lastName: 'Doe' },
      } as Row<any>;

      const row2 = {
        getValue: () => 'FACULTY',
        original: { lastName: 'Doe' },
      } as Row<any>;

      const result = roleSortingFn(row1, row2, 'role');
      expect(result).toBe(0);
    });

    it('should handle case-insensitive lastName sorting', () => {
      const row1 = {
        getValue: () => 'TA',
        original: { lastName: 'anderson' },
      } as Row<any>;

      const row2 = {
        getValue: () => 'TA',
        original: { lastName: 'Brown' },
      } as Row<any>;

      const result = roleSortingFn(row1, row2, 'role');
      expect(result).toBeLessThan(0); // anderson should come before Brown
    });

    it('should handle rows without toLowerCase method', () => {
      const row1 = {
        getValue: () => 'FACULTY',
        original: { lastName: null },
      } as Row<any>;

      const row2 = {
        getValue: () => 'FACULTY',
        original: { lastName: 'Smith' },
      } as Row<any>;

      const result = roleSortingFn(row1, row2, 'role');
      expect(typeof result).toBe('number');
    });
  });

  describe('parseCourseRole', () => {
    it('should parse valid course role strings', () => {
      expect(parseCourseRole('FACULTY')).toBe('FACULTY');
      expect(parseCourseRole('TA')).toBe('TA');
      expect(parseCourseRole('STUDENT')).toBe('STUDENT');
    });

    it('should return undefined for invalid course role strings', () => {
      expect(parseCourseRole('INVALID')).toBeUndefined();
      expect(parseCourseRole('faculty')).toBeUndefined(); // lowercase
    });

    it('should return undefined for ADMIN if not in course roles', () => {
      // ADMIN might not be a course role, only a global role
      const result = parseCourseRole('ADMIN');
      if (!courseRoleOptions.includes('ADMIN' as any)) {
        expect(result).toBeUndefined();
      }
    });

    it('should return undefined for non-string values', () => {
      expect(parseCourseRole(123)).toBeUndefined();
      expect(parseCourseRole(null)).toBeUndefined();
      expect(parseCourseRole(undefined)).toBeUndefined();
      expect(parseCourseRole({})).toBeUndefined();
    });
  });

  describe('formatCourseRole', () => {
    it('should format course role names with proper capitalization', () => {
      expect(formatCourseRole('FACULTY')).toBe('Faculty');
      expect(formatCourseRole('STUDENT')).toBe('Student');
    });

    it('should keep TA uppercase', () => {
      expect(formatCourseRole('TA')).toBe('TA');
    });

    it('should return empty string for null or undefined', () => {
      expect(formatCourseRole(null)).toBe('');
      expect(formatCourseRole(undefined)).toBe('');
    });
  });
});
