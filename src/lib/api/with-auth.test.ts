import { beforeEach, describe, expect, it, vi } from 'vitest';

const authMock = vi.hoisted(() => vi.fn());
const prismaMock = vi.hoisted(() => ({}) as Record<string, unknown>);
const createLogMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/auth', () => ({ auth: authMock }));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/activity-log-utils', () => ({ createEnhancedActivityLog: createLogMock }));

import { withAdminAuth } from './with-auth';

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
