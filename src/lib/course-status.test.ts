import { describe, it, expect } from 'vitest';
import { getCourseStatusTag } from './course-status';

describe('course-status', () => {
  describe('getCourseStatusTag', () => {
    it('should return Archived status when course is archived', () => {
      const result = getCourseStatusTag({
        isArchived: true,
        isPublished: true,
        startDate: new Date('2024-01-01'),
        endDate: new Date('2024-12-31'),
      });
      expect(result).toEqual({ status: 'Archived', variant: 'neutral' });
    });

    it('should return Archived status even when unpublished', () => {
      const result = getCourseStatusTag({
        isArchived: true,
        isPublished: false,
        startDate: new Date('2024-01-01'),
        endDate: new Date('2024-12-31'),
      });
      expect(result).toEqual({ status: 'Archived', variant: 'neutral' });
    });

    it('should return Not Published status when course is not published', () => {
      const result = getCourseStatusTag({
        isArchived: false,
        isPublished: false,
        startDate: new Date('2024-01-01'),
        endDate: new Date('2024-12-31'),
      });
      expect(result).toEqual({ status: 'Not Published', variant: 'warning' });
    });

    it('should return Upcoming status when start date is in the future', () => {
      const result = getCourseStatusTag({
        isArchived: false,
        isPublished: true,
        startDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        endDate: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000),
      });
      expect(result).toEqual({ status: 'Upcoming', variant: 'info' });
    });

    it('should return Ended status when end date is in the past', () => {
      const result = getCourseStatusTag({
        isArchived: false,
        isPublished: true,
        startDate: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000),
        endDate: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000),
      });
      expect(result).toEqual({ status: 'Ended', variant: 'danger' });
    });

    it('should return Ended status when end date equals current time', () => {
      const result = getCourseStatusTag({
        isArchived: false,
        isPublished: true,
        startDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        endDate: new Date(),
      });
      expect(result).toEqual({ status: 'Ended', variant: 'danger' });
    });

    it('should return Active status when course is currently active', () => {
      const result = getCourseStatusTag({
        isArchived: false,
        isPublished: true,
        startDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      });
      expect(result).toEqual({ status: 'Active', variant: 'success' });
    });

    it('should handle string date inputs', () => {
      const result = getCourseStatusTag({
        isArchived: false,
        isPublished: true,
        startDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
        endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      });
      expect(result).toEqual({ status: 'Active', variant: 'success' });
    });

    it('should handle date strings for upcoming course', () => {
      const result = getCourseStatusTag({
        isArchived: false,
        isPublished: true,
        startDate: '2030-01-01',
        endDate: '2030-12-31',
      });
      expect(result).toEqual({ status: 'Upcoming', variant: 'info' });
    });

    it('should handle date strings for ended course', () => {
      const result = getCourseStatusTag({
        isArchived: false,
        isPublished: true,
        startDate: '2020-01-01',
        endDate: '2020-12-31',
      });
      expect(result).toEqual({ status: 'Ended', variant: 'danger' });
    });

    it('should prioritize archived status over all other statuses', () => {
      const futureDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      const result = getCourseStatusTag({
        isArchived: true,
        isPublished: true,
        startDate: futureDate,
        endDate: futureDate,
      });
      expect(result).toEqual({ status: 'Archived', variant: 'neutral' });
    });

    it('should prioritize not published status over date-based statuses', () => {
      const result = getCourseStatusTag({
        isArchived: false,
        isPublished: false,
        startDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      });
      expect(result).toEqual({ status: 'Not Published', variant: 'warning' });
    });

    it('should handle edge case: start date equals current time (should be Active)', () => {
      const result = getCourseStatusTag({
        isArchived: false,
        isPublished: true,
        startDate: new Date(),
        endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      });
      expect(result).toEqual({ status: 'Active', variant: 'success' });
    });

    it('should handle very old dates', () => {
      const result = getCourseStatusTag({
        isArchived: false,
        isPublished: true,
        startDate: '1990-01-01',
        endDate: '1990-12-31',
      });
      expect(result).toEqual({ status: 'Ended', variant: 'danger' });
    });

    it('should handle far future dates', () => {
      const result = getCourseStatusTag({
        isArchived: false,
        isPublished: true,
        startDate: '2099-01-01',
        endDate: '2099-12-31',
      });
      expect(result).toEqual({ status: 'Upcoming', variant: 'info' });
    });
  });
});
