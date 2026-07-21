import { beforeEach, describe, expect, it, vi } from 'vitest';
import { routeCtx, testRequest } from '@/test/route';

const authMock = vi.hoisted(() => vi.fn());
const acme = vi.hoisted(() => ({ readAcmeStatus: vi.fn() }));

vi.mock('@/lib/auth', () => ({ auth: authMock }));
vi.mock('@/lib/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/activity-log-utils', () => ({ createEnhancedActivityLog: vi.fn() }));
vi.mock('@/lib/acme', () => acme);

import { GET } from './route';

const admin = { user: { id: 'a1', role: 'ADMIN', isAdmin: true } };

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/admin/settings/tls/acme-progress', () => {
  it('returns 403 for a non-admin', async () => {
    authMock.mockResolvedValue({ user: { id: 'f1', role: 'FACULTY' } });
    const res = await GET(testRequest(), routeCtx());
    expect(res.status).toBe(403);
  });

  it('returns the recorded issuance status for an admin', async () => {
    authMock.mockResolvedValue(admin);
    acme.readAcmeStatus.mockReturnValue({ phase: 'validating', message: 'wait', updatedAt: 't' });
    const res = await GET(testRequest(), routeCtx());
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ phase: 'validating', message: 'wait' });
  });

  it('returns an idle phase when nothing is recorded', async () => {
    authMock.mockResolvedValue(admin);
    acme.readAcmeStatus.mockReturnValue(null);
    const res = await GET(testRequest(), routeCtx());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ phase: 'idle' });
  });
});
