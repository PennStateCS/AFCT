import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const prismaMock = vi.hoisted(() => ({
  roster: { findMany: vi.fn(), findFirst: vi.fn() },
  user: { findMany: vi.fn() },
  assignment: { findMany: vi.fn() },
  assignmentProblemGrade: { groupBy: vi.fn() },
  groupMembership: { findMany: vi.fn() },
  course: { findUnique: vi.fn() },
}));
const authMock = vi.hoisted(() => vi.fn());
const activityLogMock = vi.hoisted(() => vi.fn());
const logErrorMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/auth', () => ({ auth: authMock }));
vi.mock('@/lib/activity-log-utils', () => ({ createEnhancedActivityLog: activityLogMock }));
vi.mock('@/lib/api/activity', () => ({ logError: logErrorMock }));

import { GET } from './route';

const req = (query = '') =>
  new NextRequest(`http://localhost/api/courses/c1/grades/export${query}`);
const ctx = { params: Promise.resolve({ id: 'c1' }) };

function seedStaffGradebook() {
  prismaMock.roster.findFirst.mockResolvedValue({ role: 'FACULTY' });
  prismaMock.roster.findMany.mockResolvedValue([{ userId: 's1', role: 'STUDENT' }]);
  prismaMock.user.findMany.mockResolvedValue([
    { id: 's1', firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com', avatar: null },
  ]);
  prismaMock.assignment.findMany.mockResolvedValue([
    { id: 'a1', title: 'Homework 1', dueDate: null, problems: [{ maxPoints: 100 }] },
  ]);
  prismaMock.assignmentProblemGrade.groupBy.mockResolvedValue([
    { studentId: 's1', assignmentId: 'a1', _sum: { grade: 95 } },
  ]);
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.roster.findFirst.mockResolvedValue(null);
  prismaMock.course.findUnique.mockResolvedValue({ isArchived: false });
  prismaMock.groupMembership.findMany.mockResolvedValue([]);
  activityLogMock.mockResolvedValue(undefined);
});

describe('GET /api/courses/[id]/grades/export', () => {
  it('403s a non-staff caller', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'STUDENT' } });
    const res = await GET(req('?platform=canvas'), ctx);
    expect(res.status).toBe(403);
  });

  it('409s an archived course without recording an export', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'FACULTY' } });
    prismaMock.roster.findFirst.mockResolvedValue({ role: 'FACULTY' });
    prismaMock.course.findUnique.mockResolvedValue({ isArchived: true });

    const res = await GET(req('?platform=canvas'), ctx);

    expect(res.status).toBe(409);
    expect(activityLogMock).not.toHaveBeenCalledWith(
      prismaMock,
      expect.anything(),
      expect.objectContaining({ action: 'GRADES_EXPORTED' }),
    );
  });

  it('returns a CSV download (with BOM) and audits the export atomically', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'FACULTY' } });
    seedStaffGradebook();

    const res = await GET(req('?platform=canvas&assignments=a1'), ctx);

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/csv');
    expect(res.headers.get('Content-Disposition')).toContain(
      'attachment; filename="grades-canvas-',
    );

    const bytes = new Uint8Array(await res.arrayBuffer());
    expect([bytes[0], bytes[1], bytes[2]]).toEqual([0xef, 0xbb, 0xbf]); // UTF-8 BOM
    const text = new TextDecoder().decode(bytes);
    expect(text).toContain('"Student","ID","SIS User ID","SIS Login ID","Section","Homework 1"');
    expect(text).toContain('ada@example.com');

    expect(activityLogMock).toHaveBeenCalledWith(
      prismaMock,
      expect.anything(),
      expect.objectContaining({
        action: 'GRADES_EXPORTED',
        severity: 'INFO',
        courseId: 'c1',
        metadata: expect.objectContaining({
          platform: 'canvas',
          wholeGradebook: false,
          assignmentCount: 1,
          studentCount: 1,
        }),
      }),
    );
  });

  it('treats a missing assignments param as the whole gradebook', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'FACULTY' } });
    seedStaffGradebook();

    const res = await GET(req('?platform=moodle'), ctx);

    expect(res.status).toBe(200);
    expect(activityLogMock).toHaveBeenCalledWith(
      prismaMock,
      expect.anything(),
      expect.objectContaining({
        metadata: expect.objectContaining({ wholeGradebook: true, assignmentCount: 1 }),
      }),
    );
  });

  it('400s when no requested assignment matches', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'FACULTY' } });
    seedStaffGradebook();

    const res = await GET(req('?platform=canvas&assignments=nope'), ctx);
    expect(res.status).toBe(400);
  });
});
