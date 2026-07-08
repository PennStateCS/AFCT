import { beforeEach, describe, expect, it, vi } from 'vitest';

const authMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/auth', () => ({ auth: authMock }));

import { GET } from './route';
import { EXPORTABLE_LOG_FIELDS } from '@/lib/log-fields';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/logs/getFields', () => {
  it('returns 403 when unauthenticated', async () => {
    authMock.mockResolvedValue(null);
    expect((await GET()).status).toBe(403);
  });

  it('returns 403 for a non-privileged role', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'STUDENT' } });
    expect((await GET()).status).toBe(403);
  });

  it('returns the exportable field list for an admin', async () => {
    authMock.mockResolvedValue({ user: { id: 'a1', role: 'ADMIN', isAdmin: true } });
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([...EXPORTABLE_LOG_FIELDS]);
  });
});
