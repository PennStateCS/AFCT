import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({}) as Record<string, unknown>);
const createLogMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/activity-log-utils', () => ({ createEnhancedActivityLog: createLogMock }));

import { logDenial, logError } from './activity';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('logDenial', () => {
  it('records a SECURITY denial and returns 403 Forbidden', async () => {
    const req = new Request('http://localhost/x');
    const res = await logDenial(req, { userId: 'u1', action: 'THING_DENIED', courseId: 'c1' });

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({ error: 'Forbidden' });
    expect(createLogMock).toHaveBeenCalledWith(
      prismaMock,
      req,
      expect.objectContaining({
        userId: 'u1',
        action: 'THING_DENIED',
        severity: 'SECURITY',
        courseId: 'c1',
      }),
    );
  });

  it('defaults userId to null and omits courseId when not provided', async () => {
    const req = new Request('http://localhost/x');
    await logDenial(req, { action: 'THING_DENIED' });

    const data = createLogMock.mock.calls[0][2] as Record<string, unknown>;
    expect(data.userId).toBeNull();
    expect('courseId' in data).toBe(false);
  });
});

describe('logError', () => {
  it('normalizes an Error into a message and logs at ERROR severity', async () => {
    const req = new Request('http://localhost/x');
    await logError(req, {
      userId: 'u1',
      action: 'THING_ERROR',
      error: new Error('boom'),
      metadata: { fileName: 'a.txt' },
    });

    expect(createLogMock).toHaveBeenCalledWith(
      prismaMock,
      req,
      expect.objectContaining({
        userId: 'u1',
        action: 'THING_ERROR',
        severity: 'ERROR',
        metadata: { fileName: 'a.txt', error: 'boom' },
      }),
    );
  });

  it('normalizes a non-Error throw to "unknown error"', async () => {
    const req = new Request('http://localhost/x');
    await logError(req, { action: 'THING_ERROR', error: 'weird' });

    const data = createLogMock.mock.calls[0][2] as { metadata: { error: string } };
    expect(data.metadata.error).toBe('unknown error');
  });
});
