import { describe, it, expect, beforeEach, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  course: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    findFirst: vi.fn(),
  },
  user: {
    findUnique: vi.fn(),
  },
  systemSettings: {
    findUnique: vi.fn(),
  },
  $transaction: vi.fn(),
}));

const authMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/auth', () => ({ auth: authMock }));
vi.mock('@/lib/zod-error', () => ({
  validationResponse: () => ({ status: 500 }),
}));

import { GET, POST } from './route';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/courses', () => {
  it('returns courses with enrolled roster', async () => {
    prismaMock.course.findMany.mockResolvedValue([
      {
        id: 'course-1',
        name: 'Course 1',
        roster: [
          {
            role: 'FACULTY',
            user: { id: 'u1', firstName: 'Ada', lastName: 'Lovelace', role: 'FACULTY' },
          },
        ],
        assignments: [],
      },
    ]);

    const res = await GET();
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toHaveLength(1);
    expect(body[0].enrolled).toEqual([
      { id: 'u1', firstName: 'Ada', lastName: 'Lovelace', role: 'FACULTY', courseRole: 'FACULTY' },
    ]);
  });
});

describe('POST /api/courses', () => {
  it('creates a course and returns enrolled roster', async () => {
    authMock.mockResolvedValue({ user: { id: 'user-1' } });
    prismaMock.user.findUnique.mockResolvedValue({ timezone: 'America/New_York' });
    prismaMock.systemSettings.findUnique.mockResolvedValue({ timezone: 'America/New_York' });
    prismaMock.course.findFirst.mockResolvedValue(null);

    const txMock = {
      course: {
        create: vi.fn().mockResolvedValue({
          id: 'course-1',
          name: 'Course 1',
          code: 'CS101',
          regCode: 'ABC123',
          semester: 'Fall 2026',
          credits: 3,
          startDate: new Date('2026-08-25T13:00:00.000Z'),
          endDate: new Date('2026-12-15T22:00:00.000Z'),
          isPublished: false,
          isArchived: false,
        }),
        findUnique: vi.fn().mockResolvedValue({
          id: 'course-1',
          roster: [
            {
              role: 'FACULTY',
              user: { id: 'u1', firstName: 'Ada', lastName: 'Lovelace', role: 'FACULTY' },
            },
          ],
        }),
      },
      roster: {
        createMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    };

    prismaMock.$transaction.mockImplementation(async (cb: any) => cb(txMock));

    const payload = {
      name: 'Course 1',
      code: 'CS101',
      semester: 'Fall 2026',
      credits: 3,
      startDate: '2026-08-25T09:00',
      endDate: '2026-12-15T17:00',
      isPublished: false,
      facultyIds: ['u1'],
    };

    const req = new Request('http://localhost/api/courses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const res = await POST(req);
    expect(res.status).toBe(201);

    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.course.enrolled).toEqual([
      { id: 'u1', firstName: 'Ada', lastName: 'Lovelace', role: 'FACULTY', courseRole: 'FACULTY' },
    ]);
  });
});
