import { describe, it, expect, vi, beforeEach } from 'vitest';
import { canArchiveCourse, canUnpublishCourse } from './course-status-checks';
import type { PrismaClient } from '@prisma/client';

describe('course-status-checks', () => {
  let mockPrisma: PrismaClient;

  beforeEach(() => {
    mockPrisma = {
      submission: {
        findFirst: vi.fn(),
      },
      assignmentProblemGrade: {
        findFirst: vi.fn(),
      },
    } as any;

    vi.clearAllMocks();
  });

  describe('canArchiveCourse', () => {
    it('should allow archiving when course is not in session', async () => {
      // Course ended in the past
      const startDate = '2023-01-01';
      const endDate = '2023-12-31';

      const result = await canArchiveCourse(mockPrisma, 'course-1', startDate, endDate);

      expect(result).toEqual({ canArchive: true });
      expect(mockPrisma.submission.findFirst).not.toHaveBeenCalled();
    });

    it('should allow archiving when course has not started yet', async () => {
      // Course starts in the future
      const startDate = '2030-01-01';
      const endDate = '2030-12-31';

      const result = await canArchiveCourse(mockPrisma, 'course-1', startDate, endDate);

      expect(result).toEqual({ canArchive: true });
      expect(mockPrisma.submission.findFirst).not.toHaveBeenCalled();
    });

    it('should allow archiving in-session course with no submissions or grades', async () => {
      // Course is in session (starts before today, ends after today)
      const startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(); // 30 days ago
      const endDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(); // 30 days from now

      vi.mocked(mockPrisma.submission.findFirst).mockResolvedValue(null);
      vi.mocked(mockPrisma.assignmentProblemGrade.findFirst).mockResolvedValue(null);

      const result = await canArchiveCourse(mockPrisma, 'course-1', startDate, endDate);

      expect(result).toEqual({ canArchive: true });
      expect(mockPrisma.submission.findFirst).toHaveBeenCalledWith({
        where: {
          assignmentProblem: {
            assignment: {
              courseId: 'course-1',
            },
          },
        },
        select: { id: true },
      });
      expect(mockPrisma.assignmentProblemGrade.findFirst).toHaveBeenCalledWith({
        where: {
          assignmentProblem: {
            assignment: {
              courseId: 'course-1',
            },
          },
        },
        select: { id: true },
      });
    });

    it('should prevent archiving in-session course with submissions', async () => {
      const startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const endDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

      vi.mocked(mockPrisma.submission.findFirst).mockResolvedValue({ id: 'submission-1' } as any);

      const result = await canArchiveCourse(mockPrisma, 'course-1', startDate, endDate);

      expect(result).toEqual({
        canArchive: false,
        reason: 'Course must not have any submitted problems or not in session to archive',
      });
      expect(mockPrisma.assignmentProblemGrade.findFirst).not.toHaveBeenCalled();
    });

    it('should prevent archiving in-session course with grades', async () => {
      const startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const endDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

      vi.mocked(mockPrisma.submission.findFirst).mockResolvedValue(null);
      vi.mocked(mockPrisma.assignmentProblemGrade.findFirst).mockResolvedValue({
        id: 'grade-1',
      } as any);

      const result = await canArchiveCourse(mockPrisma, 'course-1', startDate, endDate);

      expect(result).toEqual({
        canArchive: false,
        reason: 'Course must not have any graded assignments or not in session to archive',
      });
    });

    it('should handle edge case: course starts exactly now', async () => {
      const now = new Date().toISOString();
      const endDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

      vi.mocked(mockPrisma.submission.findFirst).mockResolvedValue(null);
      vi.mocked(mockPrisma.assignmentProblemGrade.findFirst).mockResolvedValue(null);

      const result = await canArchiveCourse(mockPrisma, 'course-1', now, endDate);

      expect(result).toEqual({ canArchive: true });
    });

    it('should handle edge case: course ends exactly now', async () => {
      const startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const now = new Date().toISOString();

      vi.mocked(mockPrisma.submission.findFirst).mockResolvedValue(null);
      vi.mocked(mockPrisma.assignmentProblemGrade.findFirst).mockResolvedValue(null);

      const result = await canArchiveCourse(mockPrisma, 'course-1', startDate, now);

      expect(result).toEqual({ canArchive: true });
    });
  });

  describe('canUnpublishCourse', () => {
    it('should allow unpublishing when no submissions or grades exist', async () => {
      vi.mocked(mockPrisma.submission.findFirst).mockResolvedValue(null);
      vi.mocked(mockPrisma.assignmentProblemGrade.findFirst).mockResolvedValue(null);

      const result = await canUnpublishCourse(mockPrisma, 'course-1');

      expect(result).toEqual({ canUnpublish: true });
      expect(mockPrisma.submission.findFirst).toHaveBeenCalledWith({
        where: {
          assignmentProblem: {
            assignment: {
              courseId: 'course-1',
            },
          },
        },
        select: { id: true },
      });
      expect(mockPrisma.assignmentProblemGrade.findFirst).toHaveBeenCalledWith({
        where: {
          assignmentProblem: {
            assignment: {
              courseId: 'course-1',
            },
          },
        },
        select: { id: true },
      });
    });

    it('should prevent unpublishing when submissions exist', async () => {
      vi.mocked(mockPrisma.submission.findFirst).mockResolvedValue({ id: 'submission-1' } as any);

      const result = await canUnpublishCourse(mockPrisma, 'course-1');

      expect(result).toEqual({
        canUnpublish: false,
        reason: 'Course must not have any submitted problems to unpublish',
      });
      expect(mockPrisma.assignmentProblemGrade.findFirst).not.toHaveBeenCalled();
    });

    it('should prevent unpublishing when grades exist', async () => {
      vi.mocked(mockPrisma.submission.findFirst).mockResolvedValue(null);
      vi.mocked(mockPrisma.assignmentProblemGrade.findFirst).mockResolvedValue({
        id: 'grade-1',
      } as any);

      const result = await canUnpublishCourse(mockPrisma, 'course-1');

      expect(result).toEqual({
        canUnpublish: false,
        reason: 'Course must not have any graded assignments to unpublish',
      });
    });

    it('should prevent unpublishing when both submissions and grades exist', async () => {
      vi.mocked(mockPrisma.submission.findFirst).mockResolvedValue({ id: 'submission-1' } as any);
      vi.mocked(mockPrisma.assignmentProblemGrade.findFirst).mockResolvedValue({
        id: 'grade-1',
      } as any);

      const result = await canUnpublishCourse(mockPrisma, 'course-1');

      expect(result).toEqual({
        canUnpublish: false,
        reason: 'Course must not have any submitted problems to unpublish',
      });
      // Should stop at submissions check
      expect(mockPrisma.assignmentProblemGrade.findFirst).not.toHaveBeenCalled();
    });

    it('should work with different courseIds', async () => {
      vi.mocked(mockPrisma.submission.findFirst).mockResolvedValue(null);
      vi.mocked(mockPrisma.assignmentProblemGrade.findFirst).mockResolvedValue(null);

      await canUnpublishCourse(mockPrisma, 'different-course-id');

      expect(mockPrisma.submission.findFirst).toHaveBeenCalledWith({
        where: {
          assignmentProblem: {
            assignment: {
              courseId: 'different-course-id',
            },
          },
        },
        select: { id: true },
      });
    });
  });
});
