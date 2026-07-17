import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  systemSettings: {
    findUnique: vi.fn(),
  },
}));

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

import { getSystemUploadLimit } from '@/lib/upload-limits';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getSystemUploadLimit', () => {
  it('defaults to 25 MB when no settings row exists', async () => {
    prismaMock.systemSettings.findUnique.mockResolvedValue(null);
    const limit = await getSystemUploadLimit();
    expect(limit).toEqual({ maxMb: 25, maxBytes: 25 * 1024 * 1024 });
  });

  it('uses the configured value and derives bytes from MB', async () => {
    prismaMock.systemSettings.findUnique.mockResolvedValue({ maxUploadSizeMb: 50 });
    const limit = await getSystemUploadLimit();
    expect(limit).toEqual({ maxMb: 50, maxBytes: 50 * 1024 * 1024 });
  });

  it('clamps a too-small value up to the 1 MB floor', async () => {
    prismaMock.systemSettings.findUnique.mockResolvedValue({ maxUploadSizeMb: 0 });
    expect((await getSystemUploadLimit()).maxMb).toBe(1);
  });

  it('clamps a too-large value down to the MAX_UPLOAD_SIZE_MB ceiling', async () => {
    prismaMock.systemSettings.findUnique.mockResolvedValue({ maxUploadSizeMb: 5000 });
    expect((await getSystemUploadLimit()).maxMb).toBe(50);
  });

  it('truncates fractional MB values', async () => {
    prismaMock.systemSettings.findUnique.mockResolvedValue({ maxUploadSizeMb: 10.9 });
    expect((await getSystemUploadLimit()).maxMb).toBe(10);
  });

  it('treats a null stored value as the default (nullish fallback)', async () => {
    prismaMock.systemSettings.findUnique.mockResolvedValue({ maxUploadSizeMb: null });
    expect((await getSystemUploadLimit()).maxMb).toBe(25);
  });
});
