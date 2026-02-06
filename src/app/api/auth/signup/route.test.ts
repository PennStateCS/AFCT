import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  user: { findUnique: vi.fn(), create: vi.fn() },
}));

const activityLogMock = vi.hoisted(() => vi.fn());
const bcryptMock = vi.hoisted(() => ({ hash: vi.fn() }));

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/activity-log-utils', () => ({ createEnhancedActivityLog: activityLogMock }));
vi.mock('bcrypt', async (importOriginal) => {
  const actual = await importOriginal<typeof import('bcrypt')>();
  return {
    ...actual,
    ...bcryptMock,
    default: {
      ...actual,
      ...bcryptMock,
    },
  };
});

import { POST } from './route';

beforeEach(() => {
  vi.clearAllMocks();
  bcryptMock.hash.mockResolvedValue('hashed');
});

describe('POST /api/auth/signup', () => {
  it('returns 400 when required fields missing', async () => {
    const req = new Request('http://localhost/api/auth/signup', {
      method: 'POST',
      body: JSON.stringify({ email: 'a@example.com' }),
    });

    const res = await POST(req);

    expect(res.status).toBe(400);
  });

  it('returns 400 when email invalid', async () => {
    const req = new Request('http://localhost/api/auth/signup', {
      method: 'POST',
      body: JSON.stringify({
        firstName: 'A',
        lastName: 'B',
        email: 'bad-email',
        password: 'Strong1!a',
      }),
    });

    const res = await POST(req);

    expect(res.status).toBe(400);
  });

  it('returns 400 when password weak', async () => {
    const req = new Request('http://localhost/api/auth/signup', {
      method: 'POST',
      body: JSON.stringify({
        firstName: 'A',
        lastName: 'B',
        email: 'a@example.com',
        password: 'weak',
      }),
    });

    const res = await POST(req);

    expect(res.status).toBe(400);
  });

  it('returns 409 when email exists', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: 'u1' });

    const req = new Request('http://localhost/api/auth/signup', {
      method: 'POST',
      body: JSON.stringify({
        firstName: 'A',
        lastName: 'B',
        email: 'a@example.com',
        password: 'Strong1!a',
      }),
    });

    const res = await POST(req);

    expect(res.status).toBe(409);
  });

  it('creates user and logs activity', async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);
    prismaMock.user.create.mockResolvedValue({ id: 'u1' });

    const req = new Request('http://localhost/api/auth/signup', {
      method: 'POST',
      body: JSON.stringify({
        firstName: 'A',
        lastName: 'B',
        email: 'a@example.com',
        password: 'Strong1!a',
      }),
    });

    const res = await POST(req);

    expect(res.status).toBe(201);
    expect(prismaMock.user.create).toHaveBeenCalled();
    expect(activityLogMock).toHaveBeenCalled();
  });
});
