import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  assignmentGrade: {
    create: vi.fn(),
    count: vi.fn(),
  },
}));

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

import { POST } from './route';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/test-grade', () => {
  it('returns success and total count', async () => {
    prismaMock.assignmentGrade.create.mockResolvedValue({ id: 'grade-1' });
    prismaMock.assignmentGrade.count.mockResolvedValue(1);

    const res = await POST();

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      success: true,
      result: { id: 'grade-1' },
      totalGrades: 1,
    });
  });

  it('returns 500 on error', async () => {
    prismaMock.assignmentGrade.create.mockRejectedValue(new Error('fail'));

    const res = await POST();

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.success).toBe(false);
  });
});
