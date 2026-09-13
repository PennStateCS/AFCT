import { beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';

const prismaMock = vi.hoisted(() => ({
  submission: {
    findFirst: vi.fn(),
  },
  roster: {
    findFirst: vi.fn(),
  },
  groupMembership: {
    findFirst: vi.fn(),
  },
  // Read by the student content gate, which non-staff callers now go through.
  assignment: { findFirst: vi.fn() },
  assignmentOverride: { findMany: vi.fn() },
}));

const authMock = vi.hoisted(() => vi.fn());
const activityLogMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/auth', () => ({ auth: authMock }));
vi.mock('@/lib/activity-log-utils', () => ({ createEnhancedActivityLog: activityLogMock }));
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  const existsSync = vi.fn().mockReturnValue(true);
  return {
    ...actual,
    existsSync,
    promises: {
      readFile: vi.fn().mockResolvedValue(Buffer.from('submission content')),
    },
    default: {
      ...actual,
      existsSync,
      promises: {
        readFile: vi.fn().mockResolvedValue(Buffer.from('submission content')),
      },
    },
  };
});

import { GET } from './route';

/**
 * A roster row for a student in good standing, as both course-permission reads see it.
 *
 * `canAccessCourse` needs the status and the course fields; `canManageCourse` reads the role
 * off the same row and finds a student, which is what keeps these callers non-staff.
 */
const enrolled = (over: Record<string, unknown> = {}) => ({
  role: 'STUDENT',
  status: 'ENROLLED',
  course: {
    isPublished: true,
    deletedAt: null,
    startDate: new Date('2020-01-01T00:00:00Z'),
  },
  ...over,
});


beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.roster.findFirst.mockResolvedValue(null);
  prismaMock.groupMembership.findFirst.mockResolvedValue(null);
  // In the audience, with nothing holding the assignment shut, unless a test says otherwise.
  prismaMock.assignment.findFirst.mockResolvedValue({
    unlockAt: null,
    dueDate: new Date('2026-01-01T00:00:00Z'),
    allowLateSubmissions: false,
    lateCutoff: null,
  });
  prismaMock.assignmentOverride.findMany.mockResolvedValue([]);
});

describe('GET /api/files/submissions/[file]', () => {
  it('returns 400 for invalid file param', async () => {
    const res = await GET(new Request('http://localhost/api/files/submissions/..'), {
      params: Promise.resolve({ file: '../secret.txt' }),
    });

    expect(res.status).toBe(400);
  });

  it('returns 401 when not authenticated', async () => {
    authMock.mockResolvedValue(null);

    const res = await GET(new Request('http://localhost/api/files/submissions/file.txt'), {
      params: Promise.resolve({ file: 'file.txt' }),
    });

    expect(res.status).toBe(401);
  });

  it('returns 404 when submission not found', async () => {
    authMock.mockResolvedValue({ user: { id: 'user-1', role: 'STUDENT' } });
    prismaMock.submission.findFirst.mockResolvedValue(null);

    const res = await GET(new Request('http://localhost/api/files/submissions/file.txt'), {
      params: Promise.resolve({ file: 'file.txt' }),
    });

    expect(res.status).toBe(404);
  });

  it('returns 403 when user is not allowed', async () => {
    authMock.mockResolvedValue({ user: { id: 'user-1' } });
    prismaMock.submission.findFirst.mockResolvedValue({
      originalFileName: 'solution.txt',
      studentId: 'user-2',
      assignmentId: 'assignment-1',
      courseId: 'course-1',
    });

    const res = await GET(new Request('http://localhost/api/files/submissions/file.txt'), {
      params: Promise.resolve({ file: 'file.txt' }),
    });

    expect(res.status).toBe(403);
    expect(activityLogMock).toHaveBeenCalledWith(
      prismaMock,
      expect.anything(),
      expect.objectContaining({
        action: 'SUBMISSION_FILE_ACCESS_DENIED',
        courseId: 'course-1',
      }),
    );
  });

  it('allows admin to download submission', async () => {
    authMock.mockResolvedValue({ user: { id: 'admin-1', isAdmin: true } });
    prismaMock.submission.findFirst.mockResolvedValue({
      id: 'sub-1',
      originalFileName: 'solution.txt',
      studentId: 'user-2',
      assignmentId: 'assignment-1',
      courseId: 'course-1',
    });
    vi.mocked(fs.existsSync).mockReturnValue(true);

    const res = await GET(
      new Request('http://localhost/api/files/submissions/file.txt?download=1'),
      { params: Promise.resolve({ file: 'file.txt' }) },
    );

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Disposition')).toContain('solution.txt');
    expect(activityLogMock).toHaveBeenCalledWith(
      prismaMock,
      expect.anything(),
      expect.objectContaining({
        action: 'DOWNLOAD_SUBMISSION_FILE',
        courseId: 'course-1',
      }),
    );
  });

  // Opening a submission in the viewer fetches the same bytes without ?download=1. It is
  // still a disclosure and still logged, but as a view: the audit log is the FERPA record
  // of who saw a student's work, so it has to say what actually happened.
  it('logs an inline view rather than a download when ?download=1 is absent', async () => {
    authMock.mockResolvedValue({ user: { id: 'admin-1', isAdmin: true } });
    prismaMock.submission.findFirst.mockResolvedValue({
      id: 'sub-1',
      originalFileName: 'solution.txt',
      studentId: 'user-2',
      assignmentId: 'assignment-1',
      courseId: 'course-1',
    });
    vi.mocked(fs.existsSync).mockReturnValue(true);

    const res = await GET(new Request('http://localhost/api/files/submissions/file.txt'), {
      params: Promise.resolve({ file: 'file.txt' }),
    });

    expect(res.status).toBe(200);
    expect(activityLogMock).toHaveBeenCalledWith(
      prismaMock,
      expect.anything(),
      expect.objectContaining({
        action: 'VIEW_SUBMISSION_FILE',
        courseId: 'course-1',
        submissionId: 'sub-1',
      }),
    );
  });

  it('allows faculty to download submission', async () => {
    authMock.mockResolvedValue({ user: { id: 'fac-1' } });
    prismaMock.submission.findFirst.mockResolvedValue({
      id: 'sub-1',
      originalFileName: 'solution.txt',
      studentId: 'user-2',
      assignmentId: 'assignment-1',
      courseId: 'course-1',
    });
    prismaMock.roster.findFirst.mockResolvedValue({ role: 'FACULTY' });
    vi.mocked(fs.existsSync).mockReturnValue(true);

    const res = await GET(new Request('http://localhost/api/files/submissions/file.txt'), {
      params: Promise.resolve({ file: 'file.txt' }),
    });

    expect(res.status).toBe(200);
  });

  it('allows TA to download submission', async () => {
    authMock.mockResolvedValue({ user: { id: 'ta-1' } });
    prismaMock.submission.findFirst.mockResolvedValue({
      id: 'sub-1',
      originalFileName: 'solution.txt',
      studentId: 'user-2',
      assignmentId: 'assignment-1',
      courseId: 'course-1',
    });
    prismaMock.roster.findFirst.mockResolvedValue({ role: 'TA' });
    vi.mocked(fs.existsSync).mockReturnValue(true);

    const res = await GET(new Request('http://localhost/api/files/submissions/file.txt'), {
      params: Promise.resolve({ file: 'file.txt' }),
    });

    expect(res.status).toBe(200);
  });

  it('allows student to download own submission', async () => {
    authMock.mockResolvedValue({ user: { id: 'student-1', role: 'STUDENT' } });
    prismaMock.roster.findFirst.mockResolvedValue(enrolled());
    prismaMock.submission.findFirst.mockResolvedValue({
      id: 'sub-1',
      originalFileName: 'solution.txt',
      studentId: 'student-1',
      assignmentId: 'assignment-1',
    });
    vi.mocked(fs.existsSync).mockReturnValue(true);

    const res = await GET(new Request('http://localhost/api/files/submissions/file.txt'), {
      params: Promise.resolve({ file: 'file.txt' }),
    });

    expect(res.status).toBe(200);
  });

  it('returns 404 when file not on disk', async () => {
    authMock.mockResolvedValue({ user: { id: 'admin-1', isAdmin: true } });
    prismaMock.submission.findFirst.mockResolvedValue({
      id: 'sub-1',
      originalFileName: 'solution.txt',
      studentId: 'user-2',
      assignmentId: 'assignment-1',
      courseId: 'course-1',
    });
    vi.mocked(fs.existsSync).mockReturnValue(false);

    const res = await GET(new Request('http://localhost/api/files/submissions/file.txt'), {
      params: Promise.resolve({ file: 'file.txt' }),
    });

    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toBe('File not found on disk');
  });

  it('returns 500 and logs when reading the file throws', async () => {
    authMock.mockResolvedValue({ user: { id: 'admin-1', isAdmin: true } });
    prismaMock.submission.findFirst.mockResolvedValue({
      id: 'sub-1',
      originalFileName: 'solution.txt',
      studentId: 'user-2',
      assignmentId: 'assignment-1',
      courseId: 'course-1',
    });
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.promises.readFile).mockRejectedValueOnce(new Error('disk failure'));

    const res = await GET(new Request('http://localhost/api/files/submissions/file.txt'), {
      params: Promise.resolve({ file: 'file.txt' }),
    });

    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toBe('Internal server error');
    expect(activityLogMock).toHaveBeenCalledWith(
      prismaMock,
      expect.anything(),
      expect.objectContaining({ action: 'SUBMISSION_FILE_ACCESS_ERROR', severity: 'ERROR' }),
    );
  });

  it('uses fileName when originalFileName is null', async () => {
    authMock.mockResolvedValue({ user: { id: 'admin-1', isAdmin: true } });
    prismaMock.submission.findFirst.mockResolvedValue({
      id: 'sub-1',
      originalFileName: null,
      studentId: 'user-2',
      assignmentId: 'assignment-1',
      courseId: 'course-1',
    });
    vi.mocked(fs.existsSync).mockReturnValue(true);

    const res = await GET(new Request('http://localhost/api/files/submissions/file.txt'), {
      params: Promise.resolve({ file: 'file.txt' }),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Disposition')).toContain('file.txt');
  });
});

/**
 * Who may open the file behind a group's shared attempt.
 *
 * Group work is one submission the whole group owns: one member uploads and AFCT shows the
 * attempt to all of them. This route only ever looked at `studentId`, so the groupmate AFCT had
 * just shown the attempt to was refused the bytes. The rule now goes through
 * `canViewStudentData`, the same one the desktop client's submission route uses, so the two
 * paths cannot answer differently.
 */
describe('a group submission', () => {
  const GROUP = 'group-1';
  const submission = {
    id: 'sub-1',
    originalFileName: 'machine.jff',
    // Uploaded by user-2, on behalf of the group.
    studentId: 'user-2',
    studentGroupId: GROUP,
    assignmentId: 'assignment-1',
    courseId: 'course-1',
  };

  const get = () =>
    GET(new Request('http://localhost/api/files/submissions/file.txt'), {
      params: Promise.resolve({ file: 'file.txt' }),
    });

  beforeEach(() => {
    prismaMock.submission.findFirst.mockResolvedValue(submission);
    vi.mocked(fs.existsSync).mockReturnValue(true);
  });

  it('serves it to the member who uploaded it', async () => {
    authMock.mockResolvedValue({ user: { id: 'user-2' } });
    prismaMock.roster.findFirst.mockResolvedValue(enrolled());

    expect((await get()).status).toBe(200);
  });

  it('serves it to a groupmate who did not upload it', async () => {
    authMock.mockResolvedValue({ user: { id: 'user-3' } });
    prismaMock.roster.findFirst.mockResolvedValue(enrolled());
    prismaMock.groupMembership.findFirst.mockResolvedValue({ id: 'gm-1' });

    const res = await get();

    expect(res.status).toBe(200);
    // Membership was checked against the group that owns the work, not "any group this pair
    // shares": a course can hold several group sets and they must not leak across.
    expect(prismaMock.groupMembership.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { groupId: GROUP, userId: 'user-3' } }),
    );
    // Asserted as well as the status, because a serve that logged nothing would be a FERPA
    // record with a hole in it, and the status alone cannot see that.
    expect(activityLogMock).toHaveBeenCalledWith(
      prismaMock,
      expect.anything(),
      expect.objectContaining({ action: 'VIEW_SUBMISSION_FILE', submissionId: 'sub-1' }),
    );
  });

  it('refuses a student who is in the course but not in that group', async () => {
    authMock.mockResolvedValue({ user: { id: 'user-9' } });
    prismaMock.roster.findFirst.mockResolvedValue(enrolled());
    prismaMock.groupMembership.findFirst.mockResolvedValue(null);

    expect((await get()).status).toBe(403);
  });

  /**
   * Dropping keeps the roster row, the work, and every group membership on purpose, and takes
   * access away through `canAccessCourse` alone. That makes it the only thing standing between
   * a dropped student and this file: "whose work is it" answers yes for them either way, since
   * they uploaded it or are still recorded in the group.
   */
  const dropped = () => enrolled({ status: 'DROPPED' });

  it('refuses the member who uploaded it once they have dropped the course', async () => {
    authMock.mockResolvedValue({ user: { id: 'user-2' } });
    prismaMock.roster.findFirst.mockResolvedValue(dropped());

    expect((await get()).status).toBe(403);
  });

  it('refuses a dropped groupmate, whose membership outlives the enrolment', async () => {
    authMock.mockResolvedValue({ user: { id: 'user-3' } });
    prismaMock.roster.findFirst.mockResolvedValue(dropped());
    // Still in the group: nothing removes the membership when somebody drops.
    prismaMock.groupMembership.findFirst.mockResolvedValue({ id: 'gm-1' });

    expect((await get()).status).toBe(403);
  });

  /**
   * Course access and ownership were as far as this went, so a student taken out of an
   * assignment's audience, or one whose assignment was put back behind an unlock time, could
   * still fetch the bytes directly while every other surface had stopped showing them.
   */
  it('refuses a member who is no longer in the assignment audience', async () => {
    authMock.mockResolvedValue({ user: { id: 'user-3' } });
    prismaMock.roster.findFirst.mockResolvedValue(enrolled());
    prismaMock.groupMembership.findFirst.mockResolvedValue({ id: 'gm-1' });
    // The gate finds nothing: the assignment is aimed at specific students, not this one.
    prismaMock.assignment.findFirst.mockResolvedValue(null);

    expect((await get()).status).toBe(403);
  });

  it('refuses while the assignment has not unlocked', async () => {
    authMock.mockResolvedValue({ user: { id: 'user-2' } });
    prismaMock.roster.findFirst.mockResolvedValue(enrolled());
    prismaMock.assignment.findFirst.mockResolvedValue({
      unlockAt: new Date('2099-01-01T00:00:00Z'),
      dueDate: new Date('2099-02-01T00:00:00Z'),
      allowLateSubmissions: false,
      lateCutoff: null,
    });

    expect((await get()).status).toBe(403);
  });

  it('does not gate staff, who set the audience', async () => {
    authMock.mockResolvedValue({ user: { id: 'fac-1' } });
    prismaMock.roster.findFirst.mockResolvedValue({
      role: 'FACULTY',
      status: 'ENROLLED',
      course: { isPublished: true, deletedAt: null, startDate: new Date('2020-01-01') },
    });
    // Would mask a student out entirely.
    prismaMock.assignment.findFirst.mockResolvedValue(null);

    expect((await get()).status).toBe(200);
  });

  it('serves it to a TA', async () => {
    authMock.mockResolvedValue({ user: { id: 'ta-1' } });
    prismaMock.roster.findFirst.mockResolvedValue({ role: 'TA' });

    expect((await get()).status).toBe(200);
  });

  it('serves it to faculty', async () => {
    authMock.mockResolvedValue({ user: { id: 'fac-1' } });
    prismaMock.roster.findFirst.mockResolvedValue({ role: 'FACULTY' });

    expect((await get()).status).toBe(200);
  });

  it('serves it to a system administrator', async () => {
    authMock.mockResolvedValue({ user: { id: 'admin-1', isAdmin: true } });

    expect((await get()).status).toBe(200);
  });
});
