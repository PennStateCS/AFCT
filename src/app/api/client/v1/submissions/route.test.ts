import { describe, it, expect, vi, beforeEach } from 'vitest';

const resolveMock = vi.hoisted(() => vi.fn());
const createSubmissionMock = vi.hoisted(() => vi.fn());
const prismaMock = vi.hoisted(() => ({ submission: { findMany: vi.fn() } }));

vi.mock('@/lib/client-auth', () => ({ resolveClientToken: resolveMock }));
vi.mock('@/lib/create-submission', () => ({ createSubmission: createSubmissionMock }));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

import { GET, POST } from './route';

const validUser = {
  tokenId: 't1',
  user: { id: 'u1', isAdmin: false, email: 'a@b.c', firstName: null, lastName: null },
};

function makeReq(authHeader?: string) {
  const form = new FormData();
  form.set('assignmentId', 'a1');
  form.set('problemId', 'p1');
  return new Request('http://localhost/api/client/v1/submissions', {
    method: 'POST',
    headers: authHeader ? { authorization: authHeader } : {},
    body: form,
  });
}
const ctx = { params: Promise.resolve({}) };

beforeEach(() => vi.clearAllMocks());

describe('POST /api/client/v1/submissions', () => {
  it('401 without a token', async () => {
    const res = await POST(makeReq(), ctx);
    expect(res.status).toBe(401);
    expect(createSubmissionMock).not.toHaveBeenCalled();
  });

  it('delegates to createSubmission and returns 202 with the id + status', async () => {
    resolveMock.mockResolvedValue({
      tokenId: 't1',
      user: { id: 'u1', isAdmin: false, email: 'a@b.c', firstName: null, lastName: null },
    });
    createSubmissionMock.mockResolvedValue({
      ok: true,
      submission: { id: 's1', status: 'PENDING' },
    });

    const res = await POST(makeReq('Bearer good'), ctx);
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ submissionId: 's1', status: 'PENDING' });
    expect(createSubmissionMock).toHaveBeenCalledWith(
      expect.objectContaining({ user: expect.objectContaining({ id: 'u1' }), assignmentId: 'a1', problemId: 'p1' }),
    );
  });

  it('maps a failed createSubmission result onto the response', async () => {
    resolveMock.mockResolvedValue({
      tokenId: 't1',
      user: { id: 'u1', isAdmin: false, email: 'a@b.c', firstName: null, lastName: null },
    });
    createSubmissionMock.mockResolvedValue({
      ok: false,
      status: 409,
      error: 'Submission limit reached (3).',
    });

    const res = await POST(makeReq('Bearer good'), ctx);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('Submission limit reached (3).');
  });
});

describe('GET /api/client/v1/submissions (history)', () => {
  const makeGet = (query: string, authHeader = 'Bearer good') =>
    new Request(`http://localhost/api/client/v1/submissions?${query}`, {
      headers: authHeader ? { authorization: authHeader } : {},
    });

  it('401 without a token', async () => {
    const res = await GET(makeGet('assignmentId=a1&problemId=p1', ''), ctx);
    expect(res.status).toBe(401);
  });

  it('400 when assignmentId or problemId is missing', async () => {
    resolveMock.mockResolvedValue(validUser);
    expect((await GET(makeGet('assignmentId=a1'), ctx)).status).toBe(400);
    expect((await GET(makeGet('problemId=p1'), ctx)).status).toBe(400);
    expect(prismaMock.submission.findMany).not.toHaveBeenCalled();
  });

  it("returns the caller's own attempts, newest first", async () => {
    resolveMock.mockResolvedValue(validUser);
    prismaMock.submission.findMany.mockResolvedValue([
      { id: 's2', status: 'COMPLETED', correct: true, submittedAt: new Date('2026-01-02T00:00:00Z') },
      { id: 's1', status: 'FAILED', correct: false, submittedAt: new Date('2026-01-01T00:00:00Z') },
    ]);

    const res = await GET(makeGet('assignmentId=a1&problemId=p1'), ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    // Scoped to the caller — never someone else's studentId.
    expect(prismaMock.submission.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { assignmentId: 'a1', problemId: 'p1', studentId: 'u1' },
        orderBy: { submittedAt: 'desc' },
      }),
    );
    expect(body.submissions.map((s: { id: string }) => s.id)).toEqual(['s2', 's1']);
  });
});
