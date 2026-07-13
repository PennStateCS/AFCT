import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({}) as Record<string, unknown>);
const createLogMock = vi.hoisted(() => vi.fn());
const canManageMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/activity-log-utils', () => ({ createEnhancedActivityLog: createLogMock }));
vi.mock('@/lib/permissions', () => ({ canManageCourse: canManageMock }));

import { logDenial, logError, denyExistence, logStudentImpactAction, logMutation } from './activity';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('logDenial', () => {
  it('records a SECURITY denial and returns 403 Forbidden', async () => {
    const req = new Request('http://localhost/x');
    const res = await logDenial(req, { userId: 'u1', action: 'THING_DENIED', courseId: 'c1' });

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({ error: 'Forbidden' });
    expect(createLogMock).toHaveBeenCalledWith(
      prismaMock,
      req,
      expect.objectContaining({
        userId: 'u1',
        action: 'THING_DENIED',
        severity: 'SECURITY',
        courseId: 'c1',
      }),
    );
  });

  it('defaults userId to null and omits courseId when not provided', async () => {
    const req = new Request('http://localhost/x');
    await logDenial(req, { action: 'THING_DENIED' });

    const data = createLogMock.mock.calls[0][2] as Record<string, unknown>;
    expect(data.userId).toBeNull();
    expect('courseId' in data).toBe(false);
  });
});

describe('logError', () => {
  it('normalizes an Error into a message and logs at ERROR severity', async () => {
    const req = new Request('http://localhost/x');
    await logError(req, {
      userId: 'u1',
      action: 'THING_ERROR',
      error: new Error('boom'),
      metadata: { fileName: 'a.txt' },
    });

    expect(createLogMock).toHaveBeenCalledWith(
      prismaMock,
      req,
      expect.objectContaining({
        userId: 'u1',
        action: 'THING_ERROR',
        severity: 'ERROR',
        metadata: { fileName: 'a.txt', error: 'boom' },
      }),
    );
  });

  it('normalizes a non-Error throw to "unknown error"', async () => {
    const req = new Request('http://localhost/x');
    await logError(req, { action: 'THING_ERROR', error: 'weird' });

    const data = createLogMock.mock.calls[0][2] as { metadata: { error: string } };
    expect(data.metadata.error).toBe('unknown error');
  });
});

describe('denyExistence', () => {
  it('returns 403 for course staff/admin (they may know it exists)', async () => {
    canManageMock.mockResolvedValue(true);
    const res = await denyExistence({ id: 's' }, 'c1');
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({ error: 'Forbidden' });
  });

  it('returns 404 for a non-staff caller (hide existence)', async () => {
    canManageMock.mockResolvedValue(false);
    const res = await denyExistence({ id: 'u' }, 'c1');
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ error: 'Not found' });
  });
});

describe('logStudentImpactAction', () => {
  it('logs actor/action/target/course with before→after at INFO by default', async () => {
    const req = new Request('http://localhost/x');
    await logStudentImpactAction(req, {
      actorId: 'staff1',
      action: 'GRADE_OVERRIDE',
      targetUserId: 'stud1',
      courseId: 'c1',
      before: 80,
      after: 95,
    });

    expect(createLogMock).toHaveBeenCalledWith(
      prismaMock,
      req,
      expect.objectContaining({
        userId: 'staff1',
        action: 'GRADE_OVERRIDE',
        severity: 'INFO',
        courseId: 'c1',
        metadata: expect.objectContaining({ targetUserId: 'stud1', before: 80, after: 95 }),
      }),
    );
  });
});

describe('logMutation', () => {
  it('logs a write at INFO with changedFields', async () => {
    const req = new Request('http://localhost/x');
    await logMutation(req, {
      userId: 'u1',
      action: 'UPDATE_ASSIGNMENT',
      courseId: 'c1',
      assignmentId: 'a1',
      changedFields: { isPublished: { from: false, to: true } },
    });

    expect(createLogMock).toHaveBeenCalledWith(
      prismaMock,
      req,
      expect.objectContaining({
        userId: 'u1',
        action: 'UPDATE_ASSIGNMENT',
        severity: 'INFO',
        assignmentId: 'a1',
        metadata: expect.objectContaining({
          changedFields: { isPublished: { from: false, to: true } },
        }),
      }),
    );
  });
});
