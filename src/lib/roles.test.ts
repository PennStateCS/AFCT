import { describe, it, expect } from 'vitest';
import {
  roleOptions,
  courseRoleOptions,
  roleOrder,
  roleSortingFn,
  parseRole,
  formatRole,
  isValidRole,
  parseCourseRole,
  formatCourseRole,
} from './roles';
import type { Row } from '@tanstack/react-table';

describe('roles', () => {
  describe('roleOptions', () => {
    it('should include all valid global roles', () => {
      expect(roleOptions).toContain('ADMIN');
      expect(roleOptions).toContain('FACULTY');
      expect(roleOptions).toContain('TA');
      expect(roleOptions).toContain('STUDENT');
    });

    it('should be an array', () => {
      expect(Array.isArray(roleOptions)).toBe(true);
    });
  });

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
      expect(roleOrder.ADMIN).toBe(1);
      expect(roleOrder.FACULTY).toBe(2);
      expect(roleOrder.TA).toBe(3);
      expect(roleOrder.STUDENT).toBe(4);
    });

    it('should have ADMIN as highest priority', () => {
      expect(roleOrder.ADMIN).toBeLessThan(roleOrder.FACULTY);
      expect(roleOrder.ADMIN).toBeLessThan(roleOrder.TA);
      expect(roleOrder.ADMIN).toBeLessThan(roleOrder.STUDENT);
    });
  });

  describe('roleSortingFn', () => {
    it('should sort by role priority', () => {
      const adminRow = {
        getValue: () => 'ADMIN',
        original: { lastName: 'Smith' },
      } as Row<any>;

      const studentRow = {
        getValue: () => 'STUDENT',
        original: { lastName: 'Jones' },
      } as Row<any>;

      const result = roleSortingFn(adminRow, studentRow, 'role');
      expect(result).toBeLessThan(0); // ADMIN should come before STUDENT
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
      expect(result).toBeGreaterThan(0); // Unknown (99) should come after STUDENT (4)
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

  describe('parseRole', () => {
    it('should parse valid role strings', () => {
      expect(parseRole('ADMIN')).toBe('ADMIN');
      expect(parseRole('FACULTY')).toBe('FACULTY');
      expect(parseRole('TA')).toBe('TA');
      expect(parseRole('STUDENT')).toBe('STUDENT');
    });

    it('should return undefined for invalid role strings', () => {
      expect(parseRole('INVALID')).toBeUndefined();
      expect(parseRole('admin')).toBeUndefined(); // lowercase
      expect(parseRole('TEACHER')).toBeUndefined();
    });

    it('should return undefined for non-string values', () => {
      expect(parseRole(123)).toBeUndefined();
      expect(parseRole(null)).toBeUndefined();
      expect(parseRole(undefined)).toBeUndefined();
      expect(parseRole({})).toBeUndefined();
      expect(parseRole([])).toBeUndefined();
    });
  });

  describe('formatRole', () => {
    it('should format role names with proper capitalization', () => {
      expect(formatRole('ADMIN')).toBe('Admin');
      expect(formatRole('FACULTY')).toBe('Faculty');
      expect(formatRole('STUDENT')).toBe('Student');
    });

    it('should keep TA uppercase', () => {
      expect(formatRole('TA')).toBe('TA');
    });

    it('should return empty string for null or undefined', () => {
      expect(formatRole(null)).toBe('');
      expect(formatRole(undefined)).toBe('');
    });
  });

  describe('isValidRole', () => {
    it('should return true for valid roles', () => {
      expect(isValidRole('ADMIN')).toBe(true);
      expect(isValidRole('FACULTY')).toBe(true);
      expect(isValidRole('TA')).toBe(true);
      expect(isValidRole('STUDENT')).toBe(true);
    });

    it('should return false for invalid roles', () => {
      expect(isValidRole('INVALID')).toBe(false);
      expect(isValidRole('admin')).toBe(false);
      expect(isValidRole('')).toBe(false);
    });

    it('should return false for non-string values', () => {
      expect(isValidRole(123)).toBe(false);
      expect(isValidRole(null)).toBe(false);
      expect(isValidRole(undefined)).toBe(false);
      expect(isValidRole({})).toBe(false);
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
