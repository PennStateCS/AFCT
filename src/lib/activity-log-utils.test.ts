import { describe, it, expect, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';
import { inferSeverity, createEnhancedActivityLog } from './activity-log-utils';

// Every action actually used in the app, mapped to its expected severity. Keeps
// the classifier honest against the real vocabulary.
const cases: Record<string, string[]> = {
  INFO: [
    'USER_SIGNUP',
    'CREATE_USER',
    'UPDATE_USER',
    'DELETE_USER',
    'VIEW_USERS',
    'RESET_PASSWORD',
    'CHANGE_PASSWORD',
    'LOGIN_SUCCESS',
    'SESSION_EXTENDED',
    'CREATE_COURSE',
    'UPDATE_COURSE',
    'DELETE_COURSE',
    'ENROLL_USER',
    'CHANGE_COURSE_ROLE',
    'CREATE_ASSIGNMENT',
    'DELETE_ASSIGNMENT',
    'CREATE_PROBLEM',
    'CREATE_COMMENT',
    'DOWNLOAD_SOLUTION_FILE',
    'TLS_CERT_INSTALLED',
    'TLS_CSR_GENERATED',
    'TLS_CERT_RESET',
    'SYSTEM_SETTINGS_UPDATED',
    'SUBMISSION_CREATED',
    'SUBMISSION_FILE_STORED',
    'SUBMISSION_EVALUATION_SUCCESS',
    'LOGIN_CHALLENGE_SOLVED',
    'SIGNUP_CHALLENGE_SOLVED',
  ],
  WARNING: [
    'SESSION_EXTENSION_FAILED',
    'SUBMISSION_INVALID_REQUEST',
    'SUBMISSION_INVALID_FILE_STRUCTURE',
    'SUBMISSION_RATE_LIMITED',
    'SUBMISSION_REJECTED_LATE',
    'SUBMISSION_REJECTED_LATE_CUTOFF',
    'SUBMISSION_FILE_TOO_LARGE',
    'SUBMISSION_EVALUATION_STDERR',
    'TLS_CERT_REJECTED',
  ],
  ERROR: [
    'SESSION_EXTENSION_ERROR',
    'LOGIN_ERROR',
    'TLS_CERT_ERROR',
    'SYSTEM_SETTINGS_UPDATE_ERROR',
    'SUBMISSION_ERROR',
    'SUBMISSION_EVALUATION_ERROR',
  ],
  SECURITY: [
    'LOGIN_FAILED',
    'LOGIN_RATE_LIMIT',
    'LOGIN_CHALLENGE_REQUIRED',
    'SIGNUP_RATE_LIMIT',
    'SIGNUP_CHALLENGE_REQUIRED',
    'SUBMISSION_UNAUTHORIZED',
    'SUBMISSION_FORBIDDEN',
    'TLS_UPDATE_DENIED',
    'SYSTEM_SETTINGS_UPDATE_DENIED',
  ],
};

describe('inferSeverity', () => {
  for (const [expected, actions] of Object.entries(cases)) {
    for (const action of actions) {
      it(`classifies ${action} as ${expected}`, () => {
        expect(inferSeverity(action)).toBe(expected);
      });
    }
  }

  it('defaults an unknown action to INFO', () => {
    expect(inferSeverity('SOMETHING_NEW')).toBe('INFO');
  });
});

describe('createEnhancedActivityLog', () => {
  const makePrisma = () => {
    const create = vi.fn().mockResolvedValue(undefined);
    return {
      prisma: {
        user: { findUnique: vi.fn().mockResolvedValue(null) },
        course: { findUnique: vi.fn().mockResolvedValue(null) },
        assignment: { findUnique: vi.fn().mockResolvedValue(null) },
        problem: { findUnique: vi.fn().mockResolvedValue(null) },
        submission: { findUnique: vi.fn().mockResolvedValue(null) },
        activityLog: { create },
      } as unknown as PrismaClient,
      create,
    };
  };

  const ctx = { ipAddress: '1.2.3.4', userAgent: 'agent' };

  it('writes a row with derived category, IP/UA, and passed metadata', async () => {
    const { prisma, create } = makePrisma();
    await createEnhancedActivityLog(prisma, ctx, {
      action: 'CREATE_COURSE',
      severity: 'INFO',
      metadata: { extra: 1 },
    });
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0].data).toMatchObject({
      action: 'CREATE_COURSE',
      category: 'COURSE',
      severity: 'INFO',
      ipAddress: '1.2.3.4',
      userAgent: 'agent',
      userId: null,
      metadata: { extra: 1 },
    });
  });

  it('honors an explicit category over the derived one', async () => {
    const { prisma, create } = makePrisma();
    await createEnhancedActivityLog(prisma, ctx, {
      action: 'COMMENT_CREATED',
      category: 'SUBMISSION',
      severity: 'INFO',
    });
    expect(create.mock.calls[0][0].data.category).toBe('SUBMISSION');
  });

  it('enriches metadata with the resolved user name and email', async () => {
    const { prisma, create } = makePrisma();
    (prisma.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'u1',
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@x.edu',
    });
    await createEnhancedActivityLog(prisma, ctx, {
      userId: 'u1',
      action: 'CREATE_COURSE',
      severity: 'INFO',
    });
    const { data } = create.mock.calls[0][0];
    expect(data.userId).toBe('u1');
    expect(data.metadata).toMatchObject({ userName: 'Ada Lovelace', userEmail: 'ada@x.edu' });
  });

  it('drops a userId that does not resolve to a user (no dangling FK)', async () => {
    const { prisma, create } = makePrisma(); // user.findUnique returns null by default
    await createEnhancedActivityLog(prisma, ctx, {
      userId: 'ghost',
      action: 'CREATE_COURSE',
      severity: 'INFO',
    });
    expect(create.mock.calls[0][0].data.userId).toBeNull();
  });

  it('enriches course/assignment/problem/submission display names', async () => {
    const { prisma, create } = makePrisma();
    (prisma.course.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      name: 'Course 1',
      code: 'CS1',
    });
    (prisma.assignment.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({ title: 'HW1' });
    (prisma.problem.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({ title: 'P1' });
    (prisma.submission.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      fileName: 'stored.jff',
      originalFileName: 'mine.jff',
    });
    await createEnhancedActivityLog(prisma, ctx, {
      action: 'SUBMISSION_CREATED',
      severity: 'INFO',
      courseId: 'c1',
      assignmentId: 'a1',
      problemId: 'p1',
      submissionId: 's1',
    });
    expect(create.mock.calls[0][0].data.metadata).toMatchObject({
      courseName: 'Course 1',
      courseCode: 'CS1',
      assignmentTitle: 'HW1',
      problemTitle: 'P1',
      submissionFileName: 'stored.jff',
      submissionOriginalFileName: 'mine.jff',
    });
  });

  it('skips display enrichment when includeDisplayMetadata is false but still verifies the user', async () => {
    const { prisma, create } = makePrisma();
    (prisma.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'u1',
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@x.edu',
    });
    await createEnhancedActivityLog(prisma, ctx, {
      userId: 'u1',
      action: 'SUBMISSION_CREATED',
      severity: 'INFO',
      courseId: 'c1',
      includeDisplayMetadata: false,
    });
    // The user is still verified (FK safety), but no display names are attached and the
    // entity lookups are skipped entirely.
    expect(prisma.course.findUnique).not.toHaveBeenCalled();
    const { data } = create.mock.calls[0][0];
    expect(data.userId).toBe('u1');
    expect(data.metadata).not.toHaveProperty('userName');
    expect(data.metadata).not.toHaveProperty('courseName');
  });

  it('swallows an FK violation (P2003) without throwing', async () => {
    const { prisma, create } = makePrisma();
    create.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('fk', { code: 'P2003', clientVersion: 'x' }),
    );
    await expect(
      createEnhancedActivityLog(prisma, ctx, { action: 'CREATE_COURSE', severity: 'INFO' }),
    ).resolves.toBeUndefined();
  });

  it('does not let an enrichment lookup failure break the write', async () => {
    const { prisma, create } = makePrisma();
    (prisma.course.findUnique as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('db blip'));
    await createEnhancedActivityLog(prisma, ctx, {
      action: 'CREATE_COURSE',
      severity: 'INFO',
      courseId: 'c1',
    });
    expect(create).toHaveBeenCalledTimes(1);
  });
});
