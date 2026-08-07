import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const prismaMock = vi.hoisted(() => ({
  roster: { findFirst: vi.fn() },
  activityLog: { findFirst: vi.fn() },
  course: { findUnique: vi.fn() },
}));

const authMock = vi.hoisted(() => vi.fn());
const activityLogMock = vi.hoisted(() => vi.fn());
const statsMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/auth', () => ({ auth: authMock }));
vi.mock('@/lib/activity-log-utils', () => ({ createEnhancedActivityLog: activityLogMock }));
vi.mock('@/lib/assignment-statistics-service', () => ({ getAssignmentStatistics: statsMock }));

import { GET } from './route';

const req = () =>
  new NextRequest('http://localhost/api/courses/c1/assignments/a1/statistics');
const ctx = { params: Promise.resolve({ id: 'c1', aid: 'a1' }) };

const stats = { unit: 'student', participantCount: 12, histogram: {}, problems: [] };

const staff = () => prismaMock.roster.findFirst.mockResolvedValue({ role: 'FACULTY' });

beforeEach(() => {
  vi.clearAllMocks();
  authMock.mockResolvedValue({ user: { id: 'u1' } });
  prismaMock.roster.findFirst.mockResolvedValue(null);
  prismaMock.course.findUnique.mockResolvedValue({ isArchived: false });
  // No recent view on record, so the throttled audit proceeds by default.
  prismaMock.activityLog.findFirst.mockResolvedValue(null);
  activityLogMock.mockResolvedValue(undefined);
  statsMock.mockResolvedValue(stats);
});

/**
 * Assignment analytics. These are aggregate student-performance figures, so the route is
 * staff-only and the read itself is audited: under FERPA the access record is the point,
 * not a nicety. The audit is throttled because the tab refetches on focus and on an
 * interval, and an unthrottled entry per refetch would bury real accesses in noise.
 */
describe('GET /api/courses/[id]/assignments/[aid]/statistics', () => {
  describe('who may read it', () => {
    it('401s when signed out', async () => {
      authMock.mockResolvedValue(null);

      expect((await GET(req(), ctx)).status).toBe(401);
      expect(statsMock).not.toHaveBeenCalled();
    });

    it('403s for a student in the course', async () => {
      prismaMock.roster.findFirst.mockResolvedValue({ role: 'STUDENT' });

      expect((await GET(req(), ctx)).status).toBe(403);
      expect(statsMock).not.toHaveBeenCalled();
    });

    it('403s for someone with no roster entry at all', async () => {
      prismaMock.roster.findFirst.mockResolvedValue(null);

      expect((await GET(req(), ctx)).status).toBe(403);
      expect(statsMock).not.toHaveBeenCalled();
    });

    it('allows a TA, who is course staff', async () => {
      prismaMock.roster.findFirst.mockResolvedValue({ role: 'TA' });

      expect((await GET(req(), ctx)).status).toBe(200);
    });

    it('allows a system admin who is not on the roster', async () => {
      authMock.mockResolvedValue({ user: { id: 'a1', isAdmin: true } });
      prismaMock.roster.findFirst.mockResolvedValue(null);

      expect((await GET(req(), ctx)).status).toBe(200);
    });
  });

  describe('the response', () => {
    it('returns the statistics for the assignment', async () => {
      staff();

      const res = await GET(req(), ctx);

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual(stats);
      expect(statsMock).toHaveBeenCalledWith('c1', 'a1');
    });

    it('404s when the assignment is not in this course', async () => {
      // The service returns null rather than throwing, so a wrong pairing of course and
      // assignment must not fall through as a 200 with an empty body.
      staff();
      statsMock.mockResolvedValue(null);

      const res = await GET(req(), ctx);

      expect(res.status).toBe(404);
    });

    it('404s when no assignment id was supplied', async () => {
      staff();

      const res = await GET(req(), { params: Promise.resolve({ id: 'c1', aid: '' }) });

      expect(res.status).toBe(404);
      expect(statsMock).not.toHaveBeenCalled();
    });

    it('500s without leaking the underlying error', async () => {
      staff();
      statsMock.mockRejectedValue(new Error('column "foo" does not exist'));

      const res = await GET(req(), ctx);

      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ error: 'Failed to fetch statistics' });
    });
  });

  describe('the read audit', () => {
    it('records the access with the actor, the course and the assignment', async () => {
      staff();

      await GET(req(), ctx);

      expect(activityLogMock).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.objectContaining({
          userId: 'u1',
          action: 'ASSIGNMENT_STATISTICS_VIEWED',
          severity: 'INFO',
          category: 'GRADE',
          courseId: 'c1',
          assignmentId: 'a1',
        }),
      );
    });

    it('does not log again while a recent view is still on record', async () => {
      // This is what stops a background refetch from flooding the log.
      staff();
      prismaMock.activityLog.findFirst.mockResolvedValue({ id: 'log-1' });

      const res = await GET(req(), ctx);

      expect(res.status).toBe(200);
      expect(activityLogMock).not.toHaveBeenCalled();
    });

    it('still serves the statistics when writing the audit fails', async () => {
      // Best-effort by design: a logging fault must not deny staff their own data.
      staff();
      activityLogMock.mockRejectedValue(new Error('log write failed'));

      const res = await GET(req(), ctx);

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual(stats);
    });
  });
});
