/**
 * The throttle is the compromise that lets a sensitive read be recorded at all: without it a
 * polling page writes hundreds of identical rows a day, and the pressure would be to log
 * nothing. So the two halves both matter, and both are easy to break silently.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  activityLog: { findFirst: vi.fn() },
}));
const writeMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/activity-log-utils', () => ({ createEnhancedActivityLog: writeMock }));

import { logThrottledView } from './activity';

const req = new Request('http://localhost/api/whatever');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('logThrottledView', () => {
  it('records the first read in a window and stays quiet for the rest', async () => {
    prismaMock.activityLog.findFirst.mockResolvedValueOnce(null);
    await logThrottledView(req, {
      userId: 'u1',
      action: 'COURSE_ROSTER_VIEWED',
      category: 'COURSE',
      courseId: 'c1',
    });
    expect(writeMock).toHaveBeenCalledTimes(1);

    // A refetch a moment later finds the entry it just wrote.
    prismaMock.activityLog.findFirst.mockResolvedValueOnce({ id: 'log1' });
    await logThrottledView(req, {
      userId: 'u1',
      action: 'COURSE_ROSTER_VIEWED',
      category: 'COURSE',
      courseId: 'c1',
    });
    expect(writeMock).toHaveBeenCalledTimes(1);
  });

  it('matches a null course rather than any course', async () => {
    prismaMock.activityLog.findFirst.mockResolvedValue(null);
    await logThrottledView(req, {
      userId: 'u1',
      action: 'ADMIN_STATUS_VIEWED',
      category: 'SYSTEM',
    });

    // `courseId: undefined` would match an entry for ANY course and swallow the write.
    expect(prismaMock.activityLog.findFirst.mock.calls[0][0].where.courseId).toBeNull();
  });

  /*
   * The read that matters most must not disappear into a window opened by a broader one:
   * browsing the log and narrowing it to one student are different acts.
   */
  it('gives a narrowed read its own window', async () => {
    prismaMock.activityLog.findFirst.mockResolvedValue(null);
    await logThrottledView(req, {
      userId: 'u1',
      action: 'ADMIN_LOGS_VIEWED',
      category: 'SYSTEM',
      key: 'user:stu-9',
    });

    const where = prismaMock.activityLog.findFirst.mock.calls[0][0].where;
    expect(where.metadata).toEqual({ path: ['viewKey'], equals: 'user:stu-9' });
    expect(writeMock.mock.calls[0][2].metadata.viewKey).toBe('user:stu-9');
  });

  /*
   * A read that has already been authorised and served must not fail because its audit write
   * did. The failure is printed, not thrown.
   */
  it('never lets a logging failure reach the caller', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    prismaMock.activityLog.findFirst.mockRejectedValue(new Error('db gone'));

    await expect(
      logThrottledView(req, { userId: 'u1', action: 'VIEW_USERS', category: 'USER' }),
    ).resolves.toBeUndefined();

    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
