import { beforeEach, describe, expect, it, vi } from 'vitest';

const authMock = vi.hoisted(() => vi.fn());
const prismaMock = vi.hoisted(() => ({}) as Record<string, unknown>);
const createLogMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/auth', () => ({ auth: authMock }));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/activity-log-utils', () => ({ createEnhancedActivityLog: createLogMock }));

import { withAdminAuth } from './with-auth';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('withAdminAuth', () => {
  it('runs the handler for a confirmed admin, passing session + user', async () => {
    const session = { user: { id: 'a1', isAdmin: true } };
    authMock.mockResolvedValue(session);
    const handler = vi.fn().mockResolvedValue(new Response('ok'));

    const wrapped = withAdminAuth(handler);
    const req = new Request('http://localhost/x');
    const res = await wrapped(req, { params: 1 });

    expect(await (res as Response).text()).toBe('ok');
    expect(handler).toHaveBeenCalledWith(req, { params: 1 }, { session, user: session.user });
  });

  it('returns 403 when there is no session', async () => {
    authMock.mockResolvedValue(null);
    const handler = vi.fn();

    const res = await withAdminAuth(handler)(new Request('http://localhost/x'), {});

    expect(res.status).toBe(403);
    await expect((res as Response).json()).resolves.toEqual({ error: 'Unauthorized' });
    expect(handler).not.toHaveBeenCalled();
  });

  it('returns 403 when the caller is signed in but not an admin', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', isAdmin: false } });
    const handler = vi.fn();

    const res = await withAdminAuth(handler)(new Request('http://localhost/x'), {});

    expect(res.status).toBe(403);
    expect(handler).not.toHaveBeenCalled();
  });

  it('records a SECURITY denial when deniedAction is set', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', isAdmin: false } });
    const req = new Request('http://localhost/x');

    await withAdminAuth(vi.fn(), { deniedAction: 'THING_DENIED' })(req, {});

    expect(createLogMock).toHaveBeenCalledWith(
      prismaMock,
      req,
      expect.objectContaining({ userId: 'u1', action: 'THING_DENIED', severity: 'SECURITY' }),
    );
  });

  it('does not log a denial when deniedAction is omitted', async () => {
    authMock.mockResolvedValue(null);

    await withAdminAuth(vi.fn())(new Request('http://localhost/x'), {});

    expect(createLogMock).not.toHaveBeenCalled();
  });
});
