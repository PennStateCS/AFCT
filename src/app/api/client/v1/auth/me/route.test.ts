import { describe, it, expect, vi, beforeEach } from 'vitest';

const resolveMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/client-auth', () => ({ resolveClientToken: resolveMock }));

import { GET } from './route';

const makeReq = (authHeader?: string) =>
  new Request('http://localhost/api/client/v1/auth/me', {
    headers: authHeader ? { authorization: authHeader } : {},
  });
const ctx = { params: Promise.resolve({}) };

beforeEach(() => vi.clearAllMocks());

describe('GET /api/client/v1/auth/me', () => {
  it('401 when the token is missing or invalid', async () => {
    resolveMock.mockResolvedValue(null);
    expect((await GET(makeReq(), ctx)).status).toBe(401);
    expect((await GET(makeReq('Bearer bad'), ctx)).status).toBe(401);
  });

  it('200 with the user when the token is valid', async () => {
    resolveMock.mockResolvedValue({
      tokenId: 't1',
      user: { id: 'u1', isAdmin: false, email: 'a@b.c', firstName: 'A', lastName: 'B' },
    });
    const res = await GET(makeReq('Bearer good'), ctx);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      user: { id: 'u1', email: 'a@b.c', firstName: 'A', lastName: 'B' },
    });
  });
});
