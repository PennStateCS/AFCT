import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  course: { findUnique: vi.fn() },
  roster: { findFirst: vi.fn() },
  problem: { findMany: vi.fn(), create: vi.fn() },
}));

const authMock = vi.hoisted(() => vi.fn());
const activityLogMock = vi.hoisted(() => vi.fn());
const logErrorMock = vi.hoisted(() => vi.fn());
const uploadLimitMock = vi.hoisted(() => vi.fn());
const validateMock = vi.hoisted(() => vi.fn());
const mkdirMock = vi.hoisted(() => vi.fn());
const writeFileMock = vi.hoisted(() => vi.fn());
const unlinkMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/auth', () => ({ auth: authMock }));
vi.mock('@/lib/activity-log-utils', () => ({ createEnhancedActivityLog: activityLogMock }));
vi.mock('@/lib/api/activity', () => ({ logError: logErrorMock }));
vi.mock('@/lib/upload-limits', () => ({ getSystemUploadLimit: uploadLimitMock }));
vi.mock('@/app/utils/xmlStructureValidate', () => ({ validateStructureXML: validateMock }));
vi.mock('fs', () => {
  const api = { promises: { mkdir: mkdirMock, writeFile: writeFileMock, unlink: unlinkMock } };
  return { default: api, ...api };
});

import { GET, POST } from './route';

const call = () =>
  GET(new Request('http://localhost/api/courses/c1/problems'), {
    params: Promise.resolve({ id: 'c1' }),
  });

beforeEach(() => {
  vi.clearAllMocks();
  authMock.mockResolvedValue({ user: { id: 'admin', isAdmin: true } });
  prismaMock.course.findUnique.mockResolvedValue({ isArchived: false, deletedAt: null });
  prismaMock.roster.findFirst.mockResolvedValue(null);
  uploadLimitMock.mockResolvedValue({ maxBytes: 5 * 1024 * 1024, maxMb: 5 });
  validateMock.mockReturnValue({ isValid: true });
  prismaMock.problem.create.mockResolvedValue({ id: 'p-new', title: 'Even zeros' });
});

describe('GET /api/courses/[id]/problems', () => {
  it('returns the course problem bank for staff', async () => {
    prismaMock.problem.findMany.mockResolvedValue([
      { id: 'p1', title: 'FA one', description: null, type: 'FA' },
    ]);
    const res = await call();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual([{ id: 'p1', title: 'FA one', description: null, type: 'FA' }]);
    expect(prismaMock.problem.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { courseId: 'c1' } }),
    );
  });

  it('rejects a non-staff caller', async () => {
    authMock.mockResolvedValue({ user: { id: 's1', isAdmin: false } });
    prismaMock.roster.findFirst.mockResolvedValue({ role: 'STUDENT', course: { deletedAt: null } });
    const res = await call();
    expect(res.status).toBe(403);
    expect(prismaMock.problem.findMany).not.toHaveBeenCalled();
  });
});

/**
 * Creating a problem in the course bank.
 *
 * The failure paths matter more than the happy one here, because this handler writes to two
 * places: a file on disk and a row in the database. A rejected upload must leave nothing behind,
 * and an insert that fails after the write must not strand the file. The upload guards are also
 * where the evaluator's XXE exposure is contained, since the jar is treated as a third-party
 * dependency and validated on our side of the boundary rather than patched.
 */
const upload = (
  fields: Record<string, string> = {},
  file: { name: string; body: string } | null = { name: 'answer.jff', body: '<structure/>' },
) => {
  const form = new FormData();
  form.set('title', 'Even zeros');
  form.set('type', 'FA');
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  if (file) form.set('file', new File([file.body], file.name, { type: 'text/xml' }));
  const req = new Request('http://localhost/api/courses/c1/problems', {
    method: 'POST',
    body: form,
  });
  return POST(req, { params: Promise.resolve({ id: 'c1' }) });
};

describe('POST /api/courses/[id]/problems', () => {
  it('creates the problem, stores the file, and logs it', async () => {
    const res = await upload();

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: 'p-new', title: 'Even zeros' });
    expect(prismaMock.problem.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          title: 'Even zeros',
          type: 'FA',
          courseId: 'c1',
          originalFileName: 'answer.jff',
        }),
      }),
    );
    expect(activityLogMock).toHaveBeenCalledWith(
      prismaMock,
      expect.anything(),
      expect.objectContaining({ action: 'CREATE_PROBLEM', severity: 'INFO', courseId: 'c1' }),
    );
  });

  it('never writes to a path built from the uploaded name', async () => {
    await upload({}, { name: '../../../../etc/passwd.jff', body: '<structure/>' });

    expect(writeFileMock).toHaveBeenCalledTimes(1);
    const [written] = writeFileMock.mock.calls[0] as [string];
    // A random UUID plus a sanitized extension. The client's name survives only as display
    // metadata on the row.
    expect(written).not.toContain('passwd');
    expect(written).not.toContain('..');
    expect(written).toMatch(/[0-9a-f-]{36}\.jff$/);
    expect(prismaMock.problem.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ originalFileName: '../../../../etc/passwd.jff' }),
      }),
    );
  });

  it('writes the solution file non-executable', async () => {
    await upload();
    expect(writeFileMock).toHaveBeenCalledWith(expect.any(String), expect.any(Buffer), {
      mode: 0o644,
    });
  });

  it('rejects a request with no file', async () => {
    const res = await upload({}, null);

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Missing required fields' });
    expect(writeFileMock).not.toHaveBeenCalled();
    expect(prismaMock.problem.create).not.toHaveBeenCalled();
  });

  it('rejects an extension outside the allow-list', async () => {
    const res = await upload({}, { name: 'solution.exe', body: 'MZ' });

    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/Allowed file types/);
    expect(writeFileMock).not.toHaveBeenCalled();
  });

  it('rejects a file over the system upload limit', async () => {
    uploadLimitMock.mockResolvedValue({ maxBytes: 4, maxMb: 5 });
    const res = await upload({}, { name: 'answer.jff', body: 'far more than four bytes' });

    expect(res.status).toBe(413);
    expect((await res.json()).error).toMatch(/exceeds max upload size \(5 MB\)/);
    expect(writeFileMock).not.toHaveBeenCalled();
  });

  it('rejects a file that fails structure validation, and records why', async () => {
    validateMock.mockReturnValue({ isValid: false, error: 'not a JFLAP structure' });
    const res = await upload();

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'not a JFLAP structure' });
    expect(writeFileMock).not.toHaveBeenCalled();
    expect(activityLogMock).toHaveBeenCalledWith(
      prismaMock,
      expect.anything(),
      expect.objectContaining({
        action: 'PROBLEM_INVALID_FILE_STRUCTURE',
        severity: 'WARNING',
      }),
    );
  });

  it('rejects scalar fields that fail the schema', async () => {
    const res = await upload({ title: '' });

    expect(res.status).toBe(400);
    expect(prismaMock.problem.create).not.toHaveBeenCalled();
  });

  it('returns 404 when the course disappeared before the write', async () => {
    // The permission helpers read the course with a `select` (isArchived, deletedAt); the
    // handler re-reads the whole row without one. Keying on that lets the auth wrapper pass
    // while the handler's own lookup is the thing that finds it gone.
    prismaMock.course.findUnique.mockImplementation((args: { select?: unknown }) =>
      Promise.resolve(args?.select ? { isArchived: false, deletedAt: null } : null),
    );
    const res = await upload();

    expect(res.status).toBe(404);
    expect(writeFileMock).not.toHaveBeenCalled();
  });

  it('deletes the stored file when the insert fails, rather than orphaning it', async () => {
    prismaMock.problem.create.mockRejectedValue(new Error('unique constraint'));
    const res = await upload();

    expect(res.status).toBe(500);
    const [written] = writeFileMock.mock.calls[0] as [string];
    expect(unlinkMock).toHaveBeenCalledWith(written);
    expect(logErrorMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'PROBLEM_CREATE_ERROR', courseId: 'c1' }),
    );
  });

  it('still reports the insert failure when the cleanup delete also fails', async () => {
    prismaMock.problem.create.mockRejectedValue(new Error('unique constraint'));
    unlinkMock.mockRejectedValue(new Error('EPERM'));
    const res = await upload();

    // A stray file is preferable to masking the real error.
    expect(res.status).toBe(500);
    expect(logErrorMock).toHaveBeenCalled();
  });

  it('rejects a non-staff caller before touching the disk', async () => {
    authMock.mockResolvedValue({ user: { id: 's1', isAdmin: false } });
    prismaMock.roster.findFirst.mockResolvedValue({ role: 'STUDENT', course: { deletedAt: null } });
    const res = await upload();

    expect(res.status).toBe(403);
    expect(writeFileMock).not.toHaveBeenCalled();
    expect(prismaMock.problem.create).not.toHaveBeenCalled();
  });

  it('is refused on an archived course', async () => {
    prismaMock.course.findUnique.mockResolvedValue({ isArchived: true, deletedAt: null });
    const res = await upload();

    expect([403, 409]).toContain(res.status);
    expect(prismaMock.problem.create).not.toHaveBeenCalled();
  });
});
