/**
 * The abandoned-files report on System Status.
 *
 * What makes this worth testing is the failure mode. A file is called abandoned by *not* finding
 * its name in a database column, so a category nobody wired up reports zero rather than reporting
 * an error, and a column the report forgets to read turns live files into "abandoned" ones an
 * admin is then invited to delete. Both directions are silent, and the delete button is beside
 * the number.
 *
 * The evaluator-trials directory was missing entirely, which is the case that matters most: a
 * trial upload is usually a real student's submission, kept for an hour precisely so it does not
 * become a lasting second copy of their work outside the access controls around the original.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  problem: { findMany: vi.fn(), findFirst: vi.fn() },
  submission: { findMany: vi.fn(), findFirst: vi.fn() },
  user: { findMany: vi.fn(), findFirst: vi.fn() },
  evaluatorTrial: { findMany: vi.fn(), findFirst: vi.fn() },
}));
const readdir = vi.hoisted(() => vi.fn());
const unlink = vi.hoisted(() => vi.fn());
const existsSync = vi.hoisted(() => vi.fn());

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('fs', () => ({
  default: { promises: { readdir, unlink }, existsSync },
  promises: { readdir, unlink },
  existsSync,
}));

import { collectAbandonedFiles, deleteAbandonedFile } from './files';

/** `readdir` is called with `withFileTypes`, so entries have to look like Dirents. */
const dirent = (name: string) => ({ name, isFile: () => true });

/** Put files in named directories; anything unlisted is empty. */
const onDisk = (dirs: Record<string, string[]>) => {
  readdir.mockImplementation(async (dir: string) => {
    const key = String(dir).split('/').pop()!;
    return (dirs[key] ?? []).map(dirent);
  });
};

beforeEach(() => {
  vi.clearAllMocks();
  onDisk({});
  prismaMock.problem.findMany.mockResolvedValue([]);
  prismaMock.submission.findMany.mockResolvedValue([]);
  prismaMock.user.findMany.mockResolvedValue([]);
  prismaMock.evaluatorTrial.findMany.mockResolvedValue([]);
  prismaMock.problem.findFirst.mockResolvedValue(null);
  prismaMock.submission.findFirst.mockResolvedValue(null);
  prismaMock.user.findFirst.mockResolvedValue(null);
  prismaMock.evaluatorTrial.findFirst.mockResolvedValue(null);
  existsSync.mockReturnValue(true);
});

describe('collectAbandonedFiles', () => {
  it('reports a file no row points at, in every category it covers', async () => {
    onDisk({
      solutions: ['s.jff'],
      submissions: ['u.jff'],
      pfps: ['a.png'],
      problems: ['p.jff'],
      trials: ['t.jff'],
    });

    const { abandonedFiles } = await collectAbandonedFiles();

    expect(abandonedFiles.byCategory).toEqual({
      solutions: 1,
      submissions: 1,
      pfps: 1,
      problems: 1,
      trials: 1,
    });
    expect(abandonedFiles.total).toBe(5);
  });

  it('leaves a file alone while its row still names it', async () => {
    onDisk({ submissions: ['kept.jff', 'orphan.jff'], pfps: ['kept.png'] });
    prismaMock.submission.findMany.mockResolvedValue([{ fileName: 'kept.jff' }]);
    prismaMock.user.findMany.mockResolvedValue([{ avatar: 'kept.png' }]);

    const { abandonedFiles } = await collectAbandonedFiles();

    expect(abandonedFiles.byCategory.submissions).toBe(1);
    expect(abandonedFiles.byCategory.pfps).toBe(0);
    expect(abandonedFiles.samples.map((s) => s.fileName)).toEqual(['orphan.jff']);
  });

  it('counts a trial upload as live whichever of its two columns holds it', async () => {
    // A trial carries an answer file and a submission file, and either can be cleared on its own.
    // Reading one column would report the other's file as abandoned and offer to delete a file
    // the trial is still using.
    onDisk({ trials: ['answer.jff', 'submitted.jff', 'left-behind.jff'] });
    prismaMock.evaluatorTrial.findMany.mockResolvedValue([
      { answerFileName: 'answer.jff', submissionFileName: null },
      { answerFileName: null, submissionFileName: 'submitted.jff' },
    ]);

    const { abandonedFiles } = await collectAbandonedFiles();

    expect(abandonedFiles.byCategory.trials).toBe(1);
    expect(abandonedFiles.samples.map((s) => s.fileName)).toEqual(['left-behind.jff']);
  });

  it('caps the samples it returns without capping the count', async () => {
    // The number is what an admin acts on; the list is only there to show what they are.
    onDisk({ submissions: Array.from({ length: 120 }, (_, i) => `f${i}.jff`) });

    const { abandonedFiles } = await collectAbandonedFiles();

    expect(abandonedFiles.total).toBe(120);
    expect(abandonedFiles.samples).toHaveLength(50);
  });

  it('says zero rather than throwing when the database is unreachable', async () => {
    onDisk({ submissions: ['u.jff'] });
    prismaMock.submission.findMany.mockRejectedValue(new Error('no connection'));

    const { abandonedFiles } = await collectAbandonedFiles();

    // Worth knowing when reading the page: a failure and a clean volume look the same here.
    expect(abandonedFiles.total).toBe(0);
    expect(abandonedFiles.byCategory.trials).toBe(0);
  });
});

describe('deleteAbandonedFile', () => {
  it('deletes a trial file nothing points at', async () => {
    expect(await deleteAbandonedFile('trials', 'left-behind.jff')).toEqual({ ok: true });
    expect(unlink).toHaveBeenCalledWith('/private/uploads/trials/left-behind.jff');
  });

  it('refuses to delete a trial file a row still names', async () => {
    prismaMock.evaluatorTrial.findFirst.mockResolvedValue({ id: 't1' });

    const result = await deleteAbandonedFile('trials', 'answer.jff');

    expect(result).toEqual({ ok: false, status: 409, error: 'File is still referenced' });
    expect(unlink).not.toHaveBeenCalled();
  });

  it('rejects a category it does not know', async () => {
    expect(await deleteAbandonedFile('backups', 'anything.tar.gz')).toMatchObject({ status: 400 });
    expect(unlink).not.toHaveBeenCalled();
  });

  it.each(['../../etc/passwd', 'nested/file.jff', '..\\windows'])(
    'rejects %s rather than resolving it',
    async (name) => {
      expect(await deleteAbandonedFile('trials', name)).toMatchObject({ status: 400 });
      expect(unlink).not.toHaveBeenCalled();
    },
  );
});
