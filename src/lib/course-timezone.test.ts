import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  course: { findUnique: vi.fn() },
  systemSettings: { findUnique: vi.fn() },
}));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

import { resolveCourseTimezone, resolveSystemTimezone } from './course-timezone';
import { DEFAULT_TIMEZONE } from './user-timezone';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('resolveCourseTimezone', () => {
  it("prefers the course's own timezone", async () => {
    prismaMock.course.findUnique.mockResolvedValue({ timezone: 'America/Chicago' });
    await expect(resolveCourseTimezone('c1')).resolves.toBe('America/Chicago');
    expect(prismaMock.systemSettings.findUnique).not.toHaveBeenCalled();
  });

  it('falls back to the system timezone when the course has none', async () => {
    prismaMock.course.findUnique.mockResolvedValue({ timezone: null });
    prismaMock.systemSettings.findUnique.mockResolvedValue({ timezone: 'Europe/London' });
    await expect(resolveCourseTimezone('c1')).resolves.toBe('Europe/London');
  });

  it('falls back to the default when neither is set', async () => {
    prismaMock.course.findUnique.mockResolvedValue(null);
    prismaMock.systemSettings.findUnique.mockResolvedValue(null);
    await expect(resolveCourseTimezone('c1')).resolves.toBe(DEFAULT_TIMEZONE);
  });

  it('skips the course lookup when no id is given', async () => {
    prismaMock.systemSettings.findUnique.mockResolvedValue({ timezone: 'UTC' });
    await expect(resolveCourseTimezone(null)).resolves.toBe('UTC');
    expect(prismaMock.course.findUnique).not.toHaveBeenCalled();
  });
});

describe('resolveSystemTimezone', () => {
  it('returns the system setting, else the default', async () => {
    prismaMock.systemSettings.findUnique.mockResolvedValue({ timezone: 'Asia/Tokyo' });
    await expect(resolveSystemTimezone()).resolves.toBe('Asia/Tokyo');

    prismaMock.systemSettings.findUnique.mockResolvedValue(null);
    await expect(resolveSystemTimezone()).resolves.toBe(DEFAULT_TIMEZONE);
  });
});
