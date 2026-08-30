import { describe, it, expect } from 'vitest';
import { courseRoleOptions, roleOrder, parseCourseRole, formatCourseRole } from './roles';

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
