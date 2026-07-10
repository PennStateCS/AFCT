import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  systemSettings: { findUnique: vi.fn() },
}));

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

import { GET } from './route';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/system-settings/public', () => {
  it('returns default timezone when settings missing', async () => {
    prismaMock.systemSettings.findUnique.mockResolvedValue(null);

    const res = await GET();

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      timezone: 'UTC',
      allowSignup: true,
      sessionTimeoutMinutes: 60,
      clock24Hour: false,
      hcaptchaSiteKey: null,
    });
  });

  it('returns stored timezone', async () => {
    prismaMock.systemSettings.findUnique.mockResolvedValue({
      id: 1,
      timezone: 'America/New_York',
      allowSignup: false,
      sessionTimeoutMinutes: 45,
    });

    const res = await GET();

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      timezone: 'America/New_York',
      allowSignup: false,
      sessionTimeoutMinutes: 45,
      clock24Hour: false,
      hcaptchaSiteKey: null,
    });
  });

  it('exposes the stored hcaptcha site key', async () => {
    prismaMock.systemSettings.findUnique.mockResolvedValue({
      id: 1,
      timezone: 'UTC',
      allowSignup: true,
      sessionTimeoutMinutes: 60,
      hcaptchaSiteKey: 'site-123',
    });

    const res = await GET();
    const body = await res.json();
    expect(body.hcaptchaSiteKey).toBe('site-123');
  });
});
