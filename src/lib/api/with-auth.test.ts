import { beforeEach, describe, expect, it, vi } from 'vitest';

const authMock = vi.hoisted(() => vi.fn());
const prismaMock = vi.hoisted(() => ({}) as Record<string, unknown>);
const createLogMock = vi.hoisted(() => vi.fn());
const canManageMock = vi.hoisted(() => vi.fn());
const canAccessMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/auth', () => ({ auth: authMock }));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/activity-log-utils', () => ({ createEnhancedActivityLog: createLogMock }));
// Keep isAdmin real (it's pure); stub the course-role checks (they hit Prisma).
vi.mock('@/lib/permissions', async (orig) => ({
  ...(await orig<typeof import('@/lib/permissions')>()),
  canManageCourse: canManageMock,
  canAccessCourse: canAccessMock,
}));

import { withAdminAuth, withCourseAuth } from './with-auth';

const DENIED = { deniedAction: 'THING_DENIED' };

beforeEach(() => {
  vi.clearAllMocks();
});

describe('withAdminAuth', () => {
  it('runs the handler for a confirmed admin, passing session + user', async () => {
    const session = { user: { id: 'a1', isAdmin: true } };
    authMock.mockResolvedValue(session);
    const handler = vi.fn().mockResolvedValue(new Response('ok'));

    const req = new Request('http://localhost/x');
    const res = await withAdminAuth(handler, DENIED)(req, { params: 1 });

    expect(await (res as Response).text()).toBe('ok');
    expect(handler).toHaveBeenCalledWith(req, { params: 1 }, { session, user: session.user });
  });

  it('returns 401 (not logged) when there is no session', async () => {
    authMock.mockResolvedValue(null);
    const handler = vi.fn();

    const res = await withAdminAuth(handler, DENIED)(new Request('http://localhost/x'), {});

    expect(res.status).toBe(401);
    await expect((res as Response).json()).resolves.toEqual({ error: 'Unauthorized' });
    expect(handler).not.toHaveBeenCalled();
    expect(createLogMock).not.toHaveBeenCalled();
  });

  it('returns 401 for a disabled/deleted account even if the token says admin', async () => {
    // The session callback marks a gone/disabled user inactive; the wrapper must
    // reject before the admin check so a stale JWT can't keep admin access.
    authMock.mockResolvedValue({ user: { id: 'a1', isAdmin: true, inactive: true } });
    const handler = vi.fn();

    const res = await withAdminAuth(handler, DENIED)(new Request('http://localhost/x'), {});

    expect(res.status).toBe(401);
    expect(handler).not.toHaveBeenCalled();
  });

  it('returns 403 Forbidden + logs a SECURITY denial for a signed-in non-admin', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', isAdmin: false } });
    const req = new Request('http://localhost/x');

    const res = await withAdminAuth(vi.fn(), DENIED)(req, {});

    expect(res.status).toBe(403);
    await expect((res as Response).json()).resolves.toEqual({ error: 'Forbidden' });
    expect(createLogMock).toHaveBeenCalledWith(
      prismaMock,
      req,
      expect.objectContaining({ userId: 'u1', action: 'THING_DENIED', severity: 'SECURITY' }),
    );
  });
});

describe('withCourseAuth', () => {
  const ctx = () => ({ params: Promise.resolve({ id: 'c1' }) });
  const manage = { access: 'manage' as const, deniedAction: 'C_DENIED' };

  it('returns 401 when there is no session', async () => {
    authMock.mockResolvedValue(null);
    const res = await withCourseAuth(vi.fn(), manage)(new Request('http://localhost/x'), ctx());
    expect(res.status).toBe(401);
    expect(canManageMock).not.toHaveBeenCalled();
  });

  it('returns 401 for a disabled/deleted account before any course check', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', inactive: true } });
    const res = await withCourseAuth(vi.fn(), manage)(new Request('http://localhost/x'), ctx());
    expect(res.status).toBe(401);
    expect(canManageMock).not.toHaveBeenCalled();
  });

  it('runs the handler for a permitted manager, passing the resolved courseId', async () => {
    const session = { user: { id: 'u1' } };
    authMock.mockResolvedValue(session);
    canManageMock.mockResolvedValue(true);
    const handler = vi.fn().mockResolvedValue(new Response('ok'));

    const req = new Request('http://localhost/x');
    const c = ctx();
    const res = await withCourseAuth(handler, manage)(req, c);

    expect(await (res as Response).text()).toBe('ok');
    expect(canManageMock).toHaveBeenCalledWith(session.user, 'c1', undefined);
    expect(handler).toHaveBeenCalledWith(req, c, {
      session,
      user: session.user,
      courseId: 'c1',
    });
  });

  it('403s + logs a course-scoped denial when management is not allowed', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1' } });
    canManageMock.mockResolvedValue(false);
    const req = new Request('http://localhost/x');

    const res = await withCourseAuth(vi.fn(), manage)(req, ctx());

    expect(res.status).toBe(403);
    await expect((res as Response).json()).resolves.toEqual({ error: 'Forbidden' });
    expect(createLogMock).toHaveBeenCalledWith(
      prismaMock,
      req,
      expect.objectContaining({ action: 'C_DENIED', severity: 'SECURITY', courseId: 'c1' }),
    );
  });

  it('uses canAccessCourse for read access', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1' } });
    canAccessMock.mockResolvedValue(true);
    const handler = vi.fn().mockResolvedValue(new Response('ok'));

    await withCourseAuth(handler, { access: 'read', deniedAction: 'C_READ_DENIED' })(
      new Request('http://localhost/x'),
      ctx(),
    );

    expect(canAccessMock).toHaveBeenCalledWith({ id: 'u1' }, 'c1');
    expect(handler).toHaveBeenCalled();
  });

  it('forwards a narrowed roles list to canManageCourse', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1' } });
    canManageMock.mockResolvedValue(true);

    await withCourseAuth(vi.fn().mockResolvedValue(new Response('ok')), {
      access: 'manage',
      deniedAction: 'C_DENIED',
      roles: ['FACULTY'],
    })(new Request('http://localhost/x'), ctx());

    expect(canManageMock).toHaveBeenCalledWith({ id: 'u1' }, 'c1', ['FACULTY']);
  });
});
