import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  assignment: { findUnique: vi.fn(), update: vi.fn() },
}));

const authMock = vi.hoisted(() => vi.fn());
const canManageCourseMock = vi.hoisted(() => vi.fn());
const activityLogMock = vi.hoisted(() => vi.fn());
const syncStateMock = vi.hoisted(() => vi.fn());
const queueChangedGradesMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/auth', () => ({ auth: authMock }));
vi.mock('@/lib/permissions', () => ({ canManageCourse: canManageCourseMock }));
// Only the writer is mocked, so `logDenial` and `safeAuditLog` themselves still run: the 403
// they build and the fields they fill in are part of what these routes promise.
vi.mock('@/lib/activity-log-utils', () => ({ createEnhancedActivityLog: activityLogMock }));
vi.mock('@/lib/lti/grade-sync', () => ({
  assignmentSyncState: syncStateMock,
  queueChangedGrades: queueChangedGradesMock,
}));

import { GET, PATCH, POST } from './route';

const ctx = { params: Promise.resolve({ id: 'a1' }) };
const url = (query = '') => `http://localhost/api/assignments/a1/lti-sync${query}`;
const get = (query = '') => new Request(url(query));
const patch = (body: unknown) =>
  new Request(url(), {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
const post = (body?: string) =>
  new Request(url(), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body }),
  });

/** The one log entry a call wrote, so a test can read what it recorded. */
const logged = () => activityLogMock.mock.calls.at(-1)?.[2];

beforeEach(() => {
  vi.clearAllMocks();
  authMock.mockResolvedValue({ user: { id: 'staff1', isAdmin: false } });
  prismaMock.assignment.findUnique.mockResolvedValue({ courseId: 'c1', ltiAutoSync: false });
  canManageCourseMock.mockResolvedValue(true);
  activityLogMock.mockResolvedValue(undefined);
  syncStateMock.mockResolvedValue({
    linked: true,
    autoSync: false,
    pending: 0,
    sent: 0,
    failed: 0,
  });
  queueChangedGradesMock.mockResolvedValue(0);
});

/**
 * The gate is hand-rolled here rather than being one of the `with*Auth` wrappers, because the
 * path has no course segment. That makes it this file's job to prove: run it against every verb,
 * since a wrapper cannot be forgotten on one but a call to a local helper can.
 */
describe.each([
  ['GET', () => GET(get(), ctx)],
  ['PATCH', () => PATCH(patch({ autoSync: true }), ctx)],
  ['POST', () => POST(post(), ctx)],
] as const)('%s /api/assignments/[id]/lti-sync', (_verb, call) => {
  it('refuses someone who is not signed in', async () => {
    authMock.mockResolvedValue(null);

    const res = await call();

    expect(res.status).toBe(401);
    expect(canManageCourseMock).not.toHaveBeenCalled();
  });

  it('is a 404 for an assignment that does not exist', async () => {
    prismaMock.assignment.findUnique.mockResolvedValue(null);

    expect((await call()).status).toBe(404);
  });

  /**
   * A refusal here is a record, not just a status. This path used to return a bare 403, so
   * somebody probing another course's grade sync left nothing behind.
   */
  it('records a refusal against the course and assignment it was aimed at', async () => {
    canManageCourseMock.mockResolvedValue(false);

    const res = await call();

    expect(res.status).toBe(403);
    expect(logged()).toMatchObject({
      userId: 'staff1',
      action: 'ASSIGNMENT_GRADE_SYNC_DENIED',
      category: 'GRADE',
      courseId: 'c1',
      assignmentId: 'a1',
      severity: 'SECURITY',
    });
  });
});

describe('GET /api/assignments/[id]/lti-sync', () => {
  it('returns the assignment-wide state', async () => {
    const res = await GET(get(), ctx);

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ linked: true, pending: 0 });
    expect(syncStateMock).toHaveBeenCalledWith('a1', undefined);
  });

  it('asks for one student when the query names them', async () => {
    await GET(get('?userId=s1'), ctx);

    expect(syncStateMock).toHaveBeenCalledWith('a1', 's1');
  });

  it('treats a blank userId as no student rather than as an empty id', async () => {
    await GET(get('?userId=%20%20'), ctx);

    expect(syncStateMock).toHaveBeenCalledWith('a1', undefined);
  });

  it('is a 404 when the assignment has no sync state to report', async () => {
    syncStateMock.mockResolvedValue(null);

    expect((await GET(get(), ctx)).status).toBe(404);
  });

  it('reads nothing on a look, so a view is not an audit entry', async () => {
    await GET(get(), ctx);

    expect(activityLogMock).not.toHaveBeenCalled();
  });
});

describe('PATCH /api/assignments/[id]/lti-sync', () => {
  it('rejects a body that is not the toggle', async () => {
    const res = await PATCH(patch({ autoSync: 'yes' }), ctx);

    expect(res.status).toBe(400);
    expect(prismaMock.assignment.update).not.toHaveBeenCalled();
  });

  it('saves the new setting and says what it now is', async () => {
    const res = await PATCH(patch({ autoSync: true }), ctx);

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ autoSync: true });
    expect(prismaMock.assignment.update).toHaveBeenCalledWith({
      where: { id: 'a1' },
      data: { ltiAutoSync: true },
    });
  });

  /**
   * This switch decides whether grades leave AFCT, so "when was it turned off, and by whom" has
   * to have an answer. The entry carries both ends of the change, not just the new value.
   */
  it('records the change with the value it moved from', async () => {
    await PATCH(patch({ autoSync: true }), ctx);

    expect(logged()).toMatchObject({
      userId: 'staff1',
      action: 'ASSIGNMENT_GRADE_SYNC_UPDATED',
      category: 'GRADE',
      courseId: 'c1',
      assignmentId: 'a1',
      metadata: { changes: { autoSync: { from: false, to: true } } },
    });
  });

  /**
   * The toggle sends its state rather than a difference, so a page that reloads and saves would
   * otherwise write an event every time and bury the real ones.
   */
  it('writes nothing when the setting did not actually move', async () => {
    prismaMock.assignment.findUnique.mockResolvedValue({ courseId: 'c1', ltiAutoSync: true });

    const res = await PATCH(patch({ autoSync: true }), ctx);

    expect(res.status).toBe(200);
    expect(activityLogMock).not.toHaveBeenCalled();
  });
});

describe('POST /api/assignments/[id]/lti-sync', () => {
  it('queues every outstanding grade when no student is named', async () => {
    queueChangedGradesMock.mockResolvedValue(12);

    const res = await POST(post(), ctx);

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ queued: 12 });
    // Retrying the failures is the point of the button: this is the only path that does it.
    expect(queueChangedGradesMock).toHaveBeenCalledWith('a1', {
      retryFailed: true,
      userId: undefined,
    });
  });

  it('queues one student when the body names them', async () => {
    queueChangedGradesMock.mockResolvedValue(1);

    await POST(post(JSON.stringify({ userId: 's1' })), ctx);

    expect(queueChangedGradesMock).toHaveBeenCalledWith('a1', {
      retryFailed: true,
      userId: 's1',
    });
  });

  it.each([
    ['malformed JSON', '{ not json'],
    ['a body of the wrong shape', JSON.stringify({ userId: 42 })],
    ['an empty student id', JSON.stringify({ userId: '   ' })],
  ])('refuses %s', async (_case, body) => {
    const res = await POST(post(body), ctx);

    expect(res.status).toBe(400);
    expect(queueChangedGradesMock).not.toHaveBeenCalled();
  });

  it('records who pressed the button and how much went', async () => {
    queueChangedGradesMock.mockResolvedValue(12);

    await POST(post(), ctx);

    expect(logged()).toMatchObject({
      userId: 'staff1',
      action: 'LTI_GRADES_PUSH_REQUESTED',
      category: 'GRADE',
      courseId: 'c1',
      assignmentId: 'a1',
      metadata: { queued: 12, scope: 'assignment' },
    });
    expect(logged()?.metadata).not.toHaveProperty('targetUserId');
  });

  /**
   * Sending one person's grade puts an education record outside AFCT, so the entry names them.
   * The per-grade LTI_SCORE_QUEUED rows do not say a human asked for it, or for what.
   */
  it('names the student when the disclosure is about one person', async () => {
    queueChangedGradesMock.mockResolvedValue(1);

    await POST(post(JSON.stringify({ userId: 's1' })), ctx);

    expect(logged()).toMatchObject({
      metadata: { queued: 1, scope: 'student', targetUserId: 's1' },
    });
  });

  it('still records the request when there was nothing to send', async () => {
    queueChangedGradesMock.mockResolvedValue(0);

    await POST(post(), ctx);

    expect(logged()).toMatchObject({ metadata: { queued: 0 } });
  });
});
