import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  systemSettings: { findUnique: vi.fn() },
}));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

import { getHcaptchaSiteKey, getHcaptchaSecretKey } from './hcaptcha';

const originalEnv = { ...process.env };

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.NEXT_PUBLIC_HCAPTCHA_SITE_KEY;
  delete process.env.HCAPTCHA_SECRET_KEY;
});

afterEach(() => {
  process.env = { ...originalEnv };
});

describe('getHcaptchaSiteKey', () => {
  it('returns the stored DB value when set', async () => {
    prismaMock.systemSettings.findUnique.mockResolvedValue({ hcaptchaSiteKey: 'db-site' });
    expect(await getHcaptchaSiteKey()).toBe('db-site');
  });

  it('falls back to the env var when the DB value is blank', async () => {
    prismaMock.systemSettings.findUnique.mockResolvedValue({ hcaptchaSiteKey: '   ' });
    process.env.NEXT_PUBLIC_HCAPTCHA_SITE_KEY = 'env-site';
    expect(await getHcaptchaSiteKey()).toBe('env-site');
  });

  it('returns null when neither the DB nor env has a value', async () => {
    prismaMock.systemSettings.findUnique.mockResolvedValue(null);
    expect(await getHcaptchaSiteKey()).toBeNull();
  });

  it('falls back to the env var when the DB query throws', async () => {
    prismaMock.systemSettings.findUnique.mockRejectedValue(new Error('db down'));
    process.env.NEXT_PUBLIC_HCAPTCHA_SITE_KEY = 'env-site';
    expect(await getHcaptchaSiteKey()).toBe('env-site');
  });
});

describe('getHcaptchaSecretKey', () => {
  it('returns the stored DB secret when set', async () => {
    prismaMock.systemSettings.findUnique.mockResolvedValue({ hcaptchaSecretKey: 'db-secret' });
    expect(await getHcaptchaSecretKey()).toBe('db-secret');
  });

  it('falls back to the env var when the DB secret is blank', async () => {
    prismaMock.systemSettings.findUnique.mockResolvedValue({ hcaptchaSecretKey: null });
    process.env.HCAPTCHA_SECRET_KEY = 'env-secret';
    expect(await getHcaptchaSecretKey()).toBe('env-secret');
  });

  it('returns null when neither the DB nor env has a value', async () => {
    prismaMock.systemSettings.findUnique.mockResolvedValue(null);
    expect(await getHcaptchaSecretKey()).toBeNull();
  });

  it('falls back to the env var when the DB query throws', async () => {
    prismaMock.systemSettings.findUnique.mockRejectedValue(new Error('db down'));
    process.env.HCAPTCHA_SECRET_KEY = 'env-secret';
    expect(await getHcaptchaSecretKey()).toBe('env-secret');
  });
});
