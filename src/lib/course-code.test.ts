import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  course: { findUnique: vi.fn() },
}));

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

import { generateUniqueCourseCode } from './course-code';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('generateUniqueCourseCode', () => {
  it('returns a code in the ABC123 format', async () => {
    prismaMock.course.findUnique.mockResolvedValue(null);

    const code = await generateUniqueCourseCode();

    expect(code).toMatch(/^[A-Z]{3}[0-9]{3}$/);
    expect(prismaMock.course.findUnique).toHaveBeenCalledWith({ where: { regCode: code } });
  });

  it('retries until it finds an unused code', async () => {
    // First generated code collides, second is free.
    prismaMock.course.findUnique
      .mockResolvedValueOnce({ id: 'existing' })
      .mockResolvedValueOnce(null);

    const code = await generateUniqueCourseCode();

    expect(code).toMatch(/^[A-Z]{3}[0-9]{3}$/);
    expect(prismaMock.course.findUnique).toHaveBeenCalledTimes(2);
  });
});
