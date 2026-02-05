import { beforeEach, describe, expect, it, vi } from 'vitest';

const authMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/auth', () => ({ auth: authMock }));

import { GET } from './route';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/uploads/pfps/[file]', () => {
  it('returns 400 for invalid file param', async () => {
    const res = await GET(new Request('http://localhost/api/uploads/pfps/..'), {
      params: Promise.resolve({ file: '../secret.txt' }),
    });

    expect(res.status).toBe(400);
  });

  it('returns 401 when not authenticated', async () => {
    authMock.mockResolvedValue(null);

    const res = await GET(new Request('http://localhost/api/uploads/pfps/avatar.png'), {
      params: Promise.resolve({ file: 'avatar.png' }),
    });

    expect(res.status).toBe(401);
  });
});
