import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  $queryRaw: vi.fn(),
  $queryRawUnsafe: vi.fn(),
  activityLog: {
    findMany: vi.fn(),
    count: vi.fn(),
  },
  user: {
    count: vi.fn(),
    findMany: vi.fn(),
  },
  course: {
    count: vi.fn(),
  },
  assignment: {
    count: vi.fn(),
  },
  problem: {
    count: vi.fn(),
    findMany: vi.fn(),
  },
  submission: {
    count: vi.fn(),
    findMany: vi.fn(),
  },
}));

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('dns', () => ({ promises: { lookup: vi.fn().mockResolvedValue([]) } }));
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  const readdir = vi.fn().mockResolvedValue([]);
  return {
    ...actual,
    promises: {
      ...actual.promises,
      readdir,
    },
    default: {
      ...actual,
      promises: {
        ...actual.promises,
        readdir,
      },
    },
  };
});

import { GET } from './route';

const envBackup = { ...process.env };

beforeEach(() => {
  vi.clearAllMocks();
  process.env.DATABASE_URL = 'sqlite://memory';
  process.env.NEXTAUTH_URL = 'http://localhost:3000';

  prismaMock.$queryRaw.mockResolvedValue([]);
  prismaMock.$queryRawUnsafe.mockResolvedValue([]);
  prismaMock.activityLog.findMany.mockResolvedValue([]);
  prismaMock.activityLog.count.mockResolvedValue(0);
  prismaMock.user.count.mockResolvedValue(0);
  prismaMock.course.count.mockResolvedValue(0);
  prismaMock.assignment.count.mockResolvedValue(0);
  prismaMock.problem.count.mockResolvedValue(0);
  prismaMock.submission.count.mockResolvedValue(0);
  prismaMock.problem.findMany.mockResolvedValue([]);
  prismaMock.submission.findMany.mockResolvedValue([]);
  prismaMock.user.findMany.mockResolvedValue([]);

  (globalThis as { fetch?: typeof fetch }).fetch = vi
    .fn()
    .mockResolvedValue(new Response(null, { status: 200 }));
});

afterEach(() => {
  process.env = { ...envBackup };
  vi.restoreAllMocks();
});

describe('GET /api/status', () => {
  it('returns status payload', async () => {
    const req = new Request('http://localhost/api/status');
    const res = await GET(req);

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.system).toBeTruthy();
    expect(body.database).toBeTruthy();
    expect(body.metrics).toBeTruthy();
    expect(body.env).toBeTruthy();
    expect(body.app).toBeTruthy();
  });
});
