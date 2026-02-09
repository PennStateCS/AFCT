import { describe, it, expect } from 'vitest';
import { getCourseStatusTag } from './course-status';

describe('course-status', () => {
  describe('getCourseStatusTag', () => {
    it('should return Archived status with gray background when course is archived', () => {
      const course = {
        isArchived: true,
        isPublished: true,
        startDate: new Date('2024-01-01'),
        endDate: new Date('2024-12-31'),
      };

      const result = getCourseStatusTag(course);

      expect(result).toEqual({
        status: 'Archived',
        bgColor: 'bg-gray-700',
      });
    });

    it('should return Archived status even when unpublished', () => {
      const course = {
        isArchived: true,
        isPublished: false,
        startDate: new Date('2024-01-01'),
        endDate: new Date('2024-12-31'),
      };

      const result = getCourseStatusTag(course);

      expect(result).toEqual({
        status: 'Archived',
        bgColor: 'bg-gray-700',
      });
    });

    it('should return Not Published status with yellow background when course is not published', () => {
      const course = {
        isArchived: false,
        isPublished: false,
        startDate: new Date('2024-01-01'),
        endDate: new Date('2024-12-31'),
      };

      const result = getCourseStatusTag(course);

      expect(result).toEqual({
        status: 'Not Published',
        bgColor: 'bg-yellow-700',
      });
    });

    it('should return Upcoming status with cyan background when start date is in the future', () => {
      const futureDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days from now
      const endDate = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000); // 60 days from now

      const course = {
        isArchived: false,
        isPublished: true,
        startDate: futureDate,
        endDate: endDate,
      };

      const result = getCourseStatusTag(course);

      expect(result).toEqual({
        status: 'Upcoming',
        bgColor: 'bg-cyan-700',
      });
    });

    it('should return Ended status with red background when end date is in the past', () => {
      const pastStartDate = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000); // 60 days ago
      const pastEndDate = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000); // 1 day ago

      const course = {
        isArchived: false,
        isPublished: true,
        startDate: pastStartDate,
        endDate: pastEndDate,
      };

      const result = getCourseStatusTag(course);

      expect(result).toEqual({
        status: 'Ended',
        bgColor: 'bg-red-700',
      });
    });

    it('should return Ended status when end date equals current time', () => {
      const now = new Date();
      const pastStartDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

      const course = {
        isArchived: false,
        isPublished: true,
        startDate: pastStartDate,
        endDate: now,
      };

      const result = getCourseStatusTag(course);

      expect(result).toEqual({
        status: 'Ended',
        bgColor: 'bg-red-700',
      });
    });

    it('should return Active status with green background when course is currently active', () => {
      const pastStartDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // 30 days ago
      const futureEndDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days from now

      const course = {
        isArchived: false,
        isPublished: true,
        startDate: pastStartDate,
        endDate: futureEndDate,
      };

      const result = getCourseStatusTag(course);

      expect(result).toEqual({
        status: 'Active',
        bgColor: 'bg-green-700',
      });
    });

    it('should handle string date inputs', () => {
      const pastStartDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const futureEndDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

      const course = {
        isArchived: false,
        isPublished: true,
        startDate: pastStartDate,
        endDate: futureEndDate,
      };

      const result = getCourseStatusTag(course);

      expect(result).toEqual({
        status: 'Active',
        bgColor: 'bg-green-700',
      });
    });

    it('should handle date strings for upcoming course', () => {
      const course = {
        isArchived: false,
        isPublished: true,
        startDate: '2030-01-01',
        endDate: '2030-12-31',
      };

      const result = getCourseStatusTag(course);

      expect(result).toEqual({
        status: 'Upcoming',
        bgColor: 'bg-cyan-700',
      });
    });

    it('should handle date strings for ended course', () => {
      const course = {
        isArchived: false,
        isPublished: true,
        startDate: '2020-01-01',
        endDate: '2020-12-31',
      };

      const result = getCourseStatusTag(course);

      expect(result).toEqual({
        status: 'Ended',
        bgColor: 'bg-red-700',
      });
    });

    it('should prioritize archived status over all other statuses', () => {
      const futureDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

      const course = {
        isArchived: true,
        isPublished: true,
        startDate: futureDate,
        endDate: futureDate,
      };

      const result = getCourseStatusTag(course);

      expect(result).toEqual({
        status: 'Archived',
        bgColor: 'bg-gray-700',
      });
    });

    it('should prioritize not published status over date-based statuses', () => {
      const pastStartDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const futureEndDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

      const course = {
        isArchived: false,
        isPublished: false,
        startDate: pastStartDate,
        endDate: futureEndDate,
      };

      const result = getCourseStatusTag(course);

      expect(result).toEqual({
        status: 'Not Published',
        bgColor: 'bg-yellow-700',
      });
    });

    it('should handle edge case: start date equals current time (should be Active)', () => {
      const now = new Date();
      const futureEndDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

      const course = {
        isArchived: false,
        isPublished: true,
        startDate: now,
        endDate: futureEndDate,
      };

      const result = getCourseStatusTag(course);

      expect(result).toEqual({
        status: 'Active',
        bgColor: 'bg-green-700',
      });
    });

    it('should handle very old dates', () => {
      const course = {
        isArchived: false,
        isPublished: true,
        startDate: '1990-01-01',
        endDate: '1990-12-31',
      };

      const result = getCourseStatusTag(course);

      expect(result).toEqual({
        status: 'Ended',
        bgColor: 'bg-red-700',
      });
    });

    it('should handle far future dates', () => {
      const course = {
        isArchived: false,
        isPublished: true,
        startDate: '2099-01-01',
        endDate: '2099-12-31',
      };

      const result = getCourseStatusTag(course);

      expect(result).toEqual({
        status: 'Upcoming',
        bgColor: 'bg-cyan-700',
      });
    });
  });
});
