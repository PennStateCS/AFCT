import { describe, it, expect, vi, beforeEach } from 'vitest';

const resolveMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/client-auth', () => ({ resolveClientToken: resolveMock }));

import { withClientAuth } from './with-client-auth';

const makeReq = (authHeader?: string) =>
  new Request('http://localhost/api/client/v1/x', {
    headers: authHeader ? { authorization: authHeader } : {},
  });

const ctx = { params: Promise.resolve({}) };

beforeEach(() => vi.clearAllMocks());

describe('withClientAuth', () => {
  it('401 when there is no Authorization header', async () => {
    const handler = vi.fn();
    const res = await withClientAuth(handler)(makeReq(), ctx);
    expect(res.status).toBe(401);
    expect(handler).not.toHaveBeenCalled();
  });

  it('401 when the header is not a Bearer token', async () => {
    const handler = vi.fn();
    const res = await withClientAuth(handler)(makeReq('Basic abc'), ctx);
    expect(res.status).toBe(401);
    expect(handler).not.toHaveBeenCalled();
  });

  it('401 when the token does not resolve', async () => {
    resolveMock.mockResolvedValue(null);
    const handler = vi.fn();
    const res = await withClientAuth(handler)(makeReq('Bearer bad'), ctx);
    expect(res.status).toBe(401);
    expect(handler).not.toHaveBeenCalled();
    expect(resolveMock).toHaveBeenCalledWith('bad');
  });

  it('runs the handler with the resolved user for a valid token', async () => {
    resolveMock.mockResolvedValue({
      tokenId: 't1',
      user: { id: 'u1', isAdmin: false, email: 'a@b.c', firstName: null, lastName: null },
    });
    const handler = vi.fn().mockResolvedValue(new Response('ok'));

    const res = await withClientAuth(handler)(makeReq('Bearer good'), ctx);

    expect(handler).toHaveBeenCalledWith(expect.anything(), ctx, {
      user: expect.objectContaining({ id: 'u1' }),
      tokenId: 't1',
    });
    expect(await res.text()).toBe('ok');
  });
});
