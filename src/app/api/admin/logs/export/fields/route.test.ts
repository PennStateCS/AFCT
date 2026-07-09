import { beforeEach, describe, expect, it, vi } from 'vitest';

const authMock = vi.hoisted(() => vi.fn());
const activityLogMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/auth', () => ({ auth: authMock }));
vi.mock('@/lib/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/activity-log-utils', () => ({ createEnhancedActivityLog: activityLogMock }));

import { GET } from './route';
import { EXPORTABLE_LOG_FIELDS } from '@/lib/log-fields';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/admin/logs/export/fields', () => {
  it('returns 401 when unauthenticated', async () => {
    authMock.mockResolvedValue(null);
    expect((await GET()).status).toBe(401);
  });

  it('returns 403 and logs a denial for a signed-in non-admin', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', isAdmin: false } });
    const res = await GET(new Request('http://localhost/api/admin/logs/export/fields'));
    expect(res.status).toBe(403);
    expect(activityLogMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ action: 'ADMIN_LOG_FIELDS_VIEW_DENIED', severity: 'SECURITY' }),
    );
  });

  it('returns the exportable field list for an admin', async () => {
    authMock.mockResolvedValue({ user: { id: 'a1', isAdmin: true } });
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([...EXPORTABLE_LOG_FIELDS]);
  });
});
