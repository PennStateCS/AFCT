import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const prismaMock = vi.hoisted(() => ({
  roster: { findFirst: vi.fn() },
  activityLog: { findFirst: vi.fn() },
  course: { findUnique: vi.fn() },
}));

const authMock = vi.hoisted(() => vi.fn());
const activityLogMock = vi.hoisted(() => vi.fn());
const getPageMock = vi.hoisted(() => vi.fn());
const getColumnsMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/auth', () => ({ auth: authMock }));
vi.mock('@/lib/activity-log-utils', () => ({ createEnhancedActivityLog: activityLogMock }));
vi.mock('@/lib/course-grades', () => ({
  getCourseGradePage: getPageMock,
  getCourseGradeColumns: getColumnsMock,
}));

import { GET } from './route';

const req = (query = '') => new NextRequest(`http://localhost/api/courses/c1/grades${query}`);
const ctx = { params: Promise.resolve({ id: 'c1' }) };
const staff = () => prismaMock.roster.findFirst.mockResolvedValue({ role: 'FACULTY' });

beforeEach(() => {
  vi.clearAllMocks();
  authMock.mockResolvedValue({ user: { id: 'u1', role: 'FACULTY' } });
  prismaMock.roster.findFirst.mockResolvedValue(null);
  prismaMock.course.findUnique.mockResolvedValue({ isArchived: false });
  // No recent view logged → the throttled read-audit proceeds to createEnhancedActivityLog.
  prismaMock.activityLog.findFirst.mockResolvedValue(null);
  activityLogMock.mockResolvedValue(undefined);
  getPageMock.mockResolvedValue({ rows: [], total: 0 });
  getColumnsMock.mockResolvedValue({ assignments: [], totalStudents: 0 });
});

describe('GET /api/courses/[id]/grades', () => {
  it('returns 400 when course ID missing', async () => {
    authMock.mockResolvedValue({ user: { id: 'a1', isAdmin: true } });

    const res = await GET(req(), { params: Promise.resolve({ id: '' }) });

    expect(res.status).toBe(400);
  });

  it('returns 401 when unauthenticated', async () => {
    authMock.mockResolvedValue(null);

    const res = await GET(req(), ctx);

    expect(res.status).toBe(401);
  });

  it('returns 403 when the caller is not course staff', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'STUDENT' } });

    const res = await GET(req(), ctx);

    expect(res.status).toBe(403);
    expect(getPageMock).not.toHaveBeenCalled();
  });

  describe('?part=columns', () => {
    it('returns the assignment columns and the student total', async () => {
      staff();
      getColumnsMock.mockResolvedValue({
        assignments: [{ id: 'a1', title: 'A1', dueDate: null, maxPoints: 10 }],
        totalStudents: 1200,
      });

      const res = await GET(req('?part=columns'), ctx);

      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toEqual({
        assignments: [{ id: 'a1', title: 'A1', dueDate: null, maxPoints: 10 }],
        totalStudents: 1200,
      });
      expect(getPageMock).not.toHaveBeenCalled();
    });

    it('does not audit a columns read, which carries no grades', async () => {
      staff();

      await GET(req('?part=columns'), ctx);

      expect(activityLogMock).not.toHaveBeenCalled();
    });
  });

  describe('paged students', () => {
    it('returns the page envelope', async () => {
      staff();
      getPageMock.mockResolvedValue({ rows: [{ id: 's1' }], total: 23 });

      const res = await GET(req('?page=2&pageSize=5'), ctx);

      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toEqual({
        rows: [{ id: 's1' }],
        total: 23,
        page: 2,
        pageSize: 5,
        totalPages: 5,
      });
    });

    it('turns page and pageSize into skip and take', async () => {
      staff();

      await GET(req('?page=3&pageSize=20'), ctx);

      expect(getPageMock).toHaveBeenCalledWith(
        expect.objectContaining({ courseId: 'c1', skip: 40, take: 20 }),
      );
    });

    it('clamps an oversized pageSize', async () => {
      staff();

      await GET(req('?pageSize=99999'), ctx);

      expect(getPageMock).toHaveBeenCalledWith(expect.objectContaining({ take: 100 }));
    });

    it('passes search and sort through, including an assignment id as the sort key', async () => {
      staff();

      await GET(req('?q=lovelace&sortBy=a1&sortDir=desc'), ctx);

      expect(getPageMock).toHaveBeenCalledWith(
        expect.objectContaining({ q: 'lovelace', sortBy: 'a1', sortDir: 'desc' }),
      );
    });
  });

  describe('read audit', () => {
    it('records the COURSE total, not the page length', async () => {
      staff();
      getPageMock.mockResolvedValue({ rows: [{ id: 's1' }], total: 1200 });

      await GET(req('?pageSize=1'), ctx);

      // The log is research data: this used to be the size of the whole matrix, and
      // paginating must not quietly redefine it as "rows on one page".
      expect(activityLogMock).toHaveBeenCalledWith(
        prismaMock,
        expect.anything(),
        expect.objectContaining({
          action: 'COURSE_GRADES_VIEWED',
          severity: 'INFO',
          category: 'GRADE',
          metadata: { studentCount: 1200 },
        }),
      );
    });

    it('stays silent while a recent view is still inside the throttle window', async () => {
      staff();
      prismaMock.activityLog.findFirst.mockResolvedValue({ id: 'log-1' });

      await GET(req(), ctx);

      expect(activityLogMock).not.toHaveBeenCalled();
    });

    it('still returns the page when the audit write fails', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      staff();
      activityLogMock.mockRejectedValue(new Error('log down'));

      const res = await GET(req(), ctx);

      expect(res.status).toBe(200);
      consoleSpy.mockRestore();
    });
  });

  it('returns 500 when the query fails', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    staff();
    getPageMock.mockRejectedValue(new Error('db down'));

    const res = await GET(req(), ctx);

    expect(res.status).toBe(500);
    consoleSpy.mockRestore();
  });

  it('returns 500 with dev detail from a non-Error thrown value', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.stubEnv('NODE_ENV', 'development');
    staff();
    getPageMock.mockRejectedValue('kaboom');

    const res = await GET(req(), ctx);

    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toMatchObject({ detail: 'kaboom' });
    consoleSpy.mockRestore();
  });
});
