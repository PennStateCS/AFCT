import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  ltiContextLink: { findMany: vi.fn(), deleteMany: vi.fn() },
}));

const authMock = vi.hoisted(() => vi.fn());
const canManageCourseMock = vi.hoisted(() => vi.fn());
const activityLogMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/auth', () => ({ auth: authMock }));
vi.mock('@/lib/permissions', () => ({ canManageCourse: canManageCourseMock }));
vi.mock('@/lib/activity-log-utils', () => ({ createEnhancedActivityLog: activityLogMock }));

import { DELETE, GET } from './route';

const ctx = { params: Promise.resolve({ id: 'c1' }) };
const url = (query = '') => `http://localhost/api/courses/c1/lti-link${query}`;
const get = () => new Request(url());
const del = (query = '') => new Request(url(query), { method: 'DELETE' });

const link = (over: Record<string, unknown> = {}) => ({
  id: 'l1',
  contextTitle: 'CMPSC 464 Section 1',
  contextId: 'ctx-1',
  createdAt: new Date('2026-08-01T00:00:00.000Z'),
  lineItemsUrl: 'https://canvas.example/line_items',
  platform: { name: 'Canvas' },
  linkedBy: { firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com' },
  ...over,
});

const links = async (res: Response) => (await res.json()).links;

beforeEach(() => {
  vi.clearAllMocks();
  authMock.mockResolvedValue({ user: { id: 'staff1', isAdmin: false } });
  canManageCourseMock.mockResolvedValue(true);
  activityLogMock.mockResolvedValue(undefined);
  prismaMock.ltiContextLink.findMany.mockResolvedValue([]);
  prismaMock.ltiContextLink.deleteMany.mockResolvedValue({ count: 1 });
});

describe.each([
  ['GET', () => GET(get(), ctx)],
  ['DELETE', () => DELETE(del('?linkId=l1'), ctx)],
] as const)('%s /api/courses/[id]/lti-link', (_verb, call) => {
  it('refuses someone who is not signed in', async () => {
    authMock.mockResolvedValue(null);

    expect((await call()).status).toBe(401);
    expect(canManageCourseMock).not.toHaveBeenCalled();
  });

  it('refuses someone who does not run the course', async () => {
    canManageCourseMock.mockResolvedValue(false);

    expect((await call()).status).toBe(403);
    expect(prismaMock.ltiContextLink.deleteMany).not.toHaveBeenCalled();
  });
});

describe('GET /api/courses/[id]/lti-link', () => {
  it('returns an empty list rather than nothing when the course is not linked', async () => {
    const res = await GET(get(), ctx);

    expect(res.status).toBe(200);
    await expect(links(res)).resolves.toEqual([]);
  });

  /**
   * More than one link is normal: cross-listed sections are separate courses in the LMS and one
   * course to the department, so the list has to hold them all.
   */
  it('lists every LMS course that opens this one', async () => {
    prismaMock.ltiContextLink.findMany.mockResolvedValue([
      link(),
      link({ id: 'l2', contextId: 'ctx-2', contextTitle: 'CMPSC 464 Section 2' }),
    ]);

    const res = await GET(get(), ctx);

    expect(await links(res)).toHaveLength(2);
    expect(prismaMock.ltiContextLink.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { courseId: 'c1' } }),
    );
  });

  it('names the LMS and who connected it', async () => {
    prismaMock.ltiContextLink.findMany.mockResolvedValue([link()]);

    const [row] = await links(await GET(get(), ctx));

    expect(row).toMatchObject({
      id: 'l1',
      platformName: 'Canvas',
      contextTitle: 'CMPSC 464 Section 1',
      contextId: 'ctx-1',
      linkedBy: 'Ada Lovelace',
    });
  });

  /**
   * "Can grades be sent" is the question faculty actually have, and the answer is whether the
   * LMS granted grade services on that link. The URL itself is not something the page needs.
   */
  it.each([
    ['can send grades when the LMS granted line items', 'https://canvas.example/line_items', true],
    ['cannot when it did not', null, false],
  ])('%s', async (_case, lineItemsUrl, canSendGrades) => {
    prismaMock.ltiContextLink.findMany.mockResolvedValue([link({ lineItemsUrl })]);

    const [row] = await links(await GET(get(), ctx));

    expect(row.canSendGrades).toBe(canSendGrades);
    expect(row).not.toHaveProperty('lineItemsUrl');
  });

  it('falls back to the address when the person who linked it has no name', async () => {
    prismaMock.ltiContextLink.findMany.mockResolvedValue([
      link({ linkedBy: { firstName: null, lastName: null, email: 'ada@example.com' } }),
    ]);

    const [row] = await links(await GET(get(), ctx));

    expect(row.linkedBy).toBe('ada@example.com');
  });

  /** The relation is nullable, so a link made before the account was deleted has nobody. */
  it('says nobody rather than breaking when the account has gone', async () => {
    prismaMock.ltiContextLink.findMany.mockResolvedValue([link({ linkedBy: null })]);

    const [row] = await links(await GET(get(), ctx));

    expect(row.linkedBy).toBeNull();
  });
});

describe('DELETE /api/courses/[id]/lti-link', () => {
  it('needs to be told which link', async () => {
    const res = await DELETE(del(), ctx);

    expect(res.status).toBe(400);
    expect(prismaMock.ltiContextLink.deleteMany).not.toHaveBeenCalled();
  });

  /**
   * Scoped to this course, so a link id belonging to somebody else's course removes nothing.
   * The delete is the authorization check as well as the write, which is why the where clause
   * is worth pinning rather than just the status.
   */
  it('only ever removes a link that belongs to this course', async () => {
    await DELETE(del('?linkId=l1'), ctx);

    expect(prismaMock.ltiContextLink.deleteMany).toHaveBeenCalledWith({
      where: { id: 'l1', courseId: 'c1' },
    });
  });

  it('is a 404 when that link is not on this course', async () => {
    prismaMock.ltiContextLink.deleteMany.mockResolvedValue({ count: 0 });

    const res = await DELETE(del('?linkId=elsewhere'), ctx);

    expect(res.status).toBe(404);
    expect(activityLogMock).not.toHaveBeenCalled();
  });

  it('disconnects the link', async () => {
    const res = await DELETE(del('?linkId=l1'), ctx);

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ success: true });
  });

  /**
   * A WARNING, not an INFO: disconnecting stops grades reaching the LMS, and the symptom shows
   * up later as grades quietly not arriving. The entry is how that gets traced back.
   */
  it('records the disconnection against the course', async () => {
    await DELETE(del('?linkId=l1'), ctx);

    expect(activityLogMock.mock.calls.at(-1)?.[2]).toMatchObject({
      userId: 'staff1',
      courseId: 'c1',
      action: 'LTI_COURSE_UNLINKED',
      severity: 'WARNING',
      category: 'COURSE',
      metadata: { linkId: 'l1' },
    });
  });
});
