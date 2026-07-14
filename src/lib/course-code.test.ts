import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';

const prismaMock = vi.hoisted(() => ({
  course: { findUnique: vi.fn() },
}));

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

import {
  generateUniqueCourseCode,
  isRegCodeConflict,
  createWithUniqueCourseCode,
} from './course-code';

const regCodeConflict = () =>
  new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
    meta: { target: ['regCode'] },
  });

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.course.findUnique.mockResolvedValue(null);
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

describe('isRegCodeConflict', () => {
  it('is true only for a P2002 on regCode', () => {
    expect(isRegCodeConflict(regCodeConflict())).toBe(true);
    // Different unique field.
    expect(
      isRegCodeConflict(
        new Prisma.PrismaClientKnownRequestError('x', {
          code: 'P2002',
          clientVersion: 't',
          meta: { target: ['code'] },
        }),
      ),
    ).toBe(false);
    // Different Prisma error code.
    expect(
      isRegCodeConflict(
        new Prisma.PrismaClientKnownRequestError('x', { code: 'P2025', clientVersion: 't' }),
      ),
    ).toBe(false);
    expect(isRegCodeConflict(new Error('nope'))).toBe(false);
  });
});

describe('createWithUniqueCourseCode', () => {
  it('runs create once with a generated code and returns its result', async () => {
    const create = vi.fn(async (regCode: string) => `made-${regCode}`);

    const result = await createWithUniqueCourseCode(create);

    expect(create).toHaveBeenCalledTimes(1);
    expect(result).toBe(`made-${create.mock.calls[0]![0]}`);
    expect(create.mock.calls[0]![0]).toMatch(/^[A-Z]{3}[0-9]{3}$/);
  });

  it('retries with a fresh code on a regCode conflict, then succeeds', async () => {
    const create = vi
      .fn()
      .mockRejectedValueOnce(regCodeConflict())
      .mockResolvedValueOnce('ok');

    const result = await createWithUniqueCourseCode(create);

    expect(result).toBe('ok');
    expect(create).toHaveBeenCalledTimes(2);
    // A fresh code was generated for each attempt.
    expect(prismaMock.course.findUnique).toHaveBeenCalledTimes(2);
  });

  it('rethrows a non-conflict error without retrying', async () => {
    const create = vi.fn().mockRejectedValue(new Error('db down'));

    await expect(createWithUniqueCourseCode(create)).rejects.toThrow('db down');
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('gives up after the attempt limit and rethrows the conflict', async () => {
    const create = vi.fn().mockRejectedValue(regCodeConflict());

    await expect(createWithUniqueCourseCode(create, 3)).rejects.toBeInstanceOf(
      Prisma.PrismaClientKnownRequestError,
    );
    expect(create).toHaveBeenCalledTimes(3);
  });
});
