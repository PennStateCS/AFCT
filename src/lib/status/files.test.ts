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
const stat = vi.hoisted(() => vi.fn());
const existsSync = vi.hoisted(() => vi.fn());

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
const statfs = vi.hoisted(() => vi.fn());

vi.mock('fs', () => ({
  default: { promises: { readdir, unlink, stat, statfs }, existsSync },
  promises: { readdir, unlink, stat, statfs },
  existsSync,
}));

import {
  collectAbandonedFiles,
  deleteAbandonedFile,
  deleteAbandonedFilesInCategory,
} from './files';

/** Category counts keyed by name, the shape most assertions here want. */
const counts = (summary: { categories: Array<{ category: string; count: number }> }) =>
  Object.fromEntries(summary.categories.map((c) => [c.category, c.count]));

const labelFor = (category: string) => LABELS[category];
const LABELS: Record<string, string> = {
  submissions: 'Student submissions',
  solutions: 'Reference solutions',
  pfps: 'Profile photos',
  trials: 'Evaluator trials',
  problems: 'Problem files',
};

/** `readdir` is called with `withFileTypes`, so entries have to look like Dirents. */
const dirent = (name: string) => ({ name, isFile: () => true });

/** Put files in named directories; anything unlisted is empty. */
const onDisk = (dirs: Record<string, string[]>) => {
  readdir.mockImplementation(async (dir: string) => {
    const key = String(dir).split('/').pop()!;
    return (dirs[key] ?? []).map(dirent);
  });
};

/** Every file is 1 KB unless a test says otherwise. */
const sized = (bytes = 1024) => stat.mockResolvedValue({ size: bytes, mtimeMs: 1_700_000_000_000 });

beforeEach(() => {
  vi.clearAllMocks();
  onDisk({});
  sized();
  statfs.mockRejectedValue(new Error('not supported'));
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

    expect(counts(abandonedFiles)).toEqual({
      solutions: 1,
      submissions: 1,
      pfps: 1,
      problems: 1,
      trials: 1,
    });
    expect(abandonedFiles.total).toBe(5);
  });

  it('gives every category a name a person would use, not the folder name', () => {
    // The operators here are professors, not the developer who named the directories.
    expect(labelFor('pfps')).toBe('Profile photos');
    expect(labelFor('trials')).toBe('Evaluator trials');
    expect(labelFor('submissions')).toBe('Student submissions');
  });

  it('reports how much space each category would free', async () => {
    // File count is not the question an admin has; disk is. VM 201 fills after about seven
    // upgrades, so bytes are what decides whether this page is worth acting on.
    onDisk({ submissions: ['a.jff', 'b.jff'] });
    sized(1_500);

    const { abandonedFiles } = await collectAbandonedFiles();

    expect(abandonedFiles.totalSizeBytes).toBe(3_000);
    expect(abandonedFiles.categories.find((c) => c.category === 'submissions')?.sizeBytes).toBe(
      3_000,
    );
    expect(abandonedFiles.files[0]).toMatchObject({ sizeBytes: 1_500 });
  });

  it('lists the biggest files first', async () => {
    onDisk({ submissions: ['small.jff', 'big.jff'] });
    stat.mockImplementation(async (p: string) => ({
      size: String(p).includes('big') ? 9_000 : 10,
      mtimeMs: 1_700_000_000_000,
    }));

    const { abandonedFiles } = await collectAbandonedFiles();

    expect(abandonedFiles.files.map((f) => f.fileName)).toEqual(['big.jff', 'small.jff']);
  });

  it('leaves a file alone while its row still names it', async () => {
    onDisk({ submissions: ['kept.jff', 'orphan.jff'], pfps: ['kept.png'] });
    prismaMock.submission.findMany.mockResolvedValue([{ fileName: 'kept.jff' }]);
    prismaMock.user.findMany.mockResolvedValue([{ avatar: 'kept.png' }]);

    const { abandonedFiles } = await collectAbandonedFiles();

    expect(counts(abandonedFiles).submissions).toBe(1);
    expect(counts(abandonedFiles).pfps).toBe(0);
    expect(abandonedFiles.files.map((f) => f.fileName)).toEqual(['orphan.jff']);
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

    expect(counts(abandonedFiles).trials).toBe(1);
    expect(abandonedFiles.files.map((f) => f.fileName)).toEqual(['left-behind.jff']);
  });

  it('caps the list it returns without capping the count or the total size', async () => {
    // The numbers are what an admin acts on; the list is only there to show what they are, and
    // "Delete all" works from the server's own scan rather than from this list.
    onDisk({ submissions: Array.from({ length: 600 }, (_, i) => `f${i}.jff`) });

    const { abandonedFiles } = await collectAbandonedFiles();

    expect(abandonedFiles.total).toBe(600);
    expect(abandonedFiles.totalSizeBytes).toBe(600 * 1024);
    expect(abandonedFiles.files).toHaveLength(abandonedFiles.listLimit);
  });

  it('reports a failure as a failure, not as a clean volume', async () => {
    // The whole point. Answering an error with zeroes rendered as "No abandoned files found",
    // so a database that could not be reached looked like good news, and that is exactly how a
    // missing category went unnoticed for as long as it did.
    onDisk({ submissions: ['u.jff'] });
    prismaMock.submission.findMany.mockRejectedValue(new Error('no connection'));

    const { abandonedFiles } = await collectAbandonedFiles();

    expect(abandonedFiles.error).toContain('could not be completed');
  });

  it('says which folder could not be read instead of counting it as empty', async () => {
    readdir.mockImplementation(async (dir: string) => {
      if (String(dir).endsWith('trials'))
        throw Object.assign(new Error('denied'), { code: 'EACCES' });
      return [];
    });

    const { abandonedFiles } = await collectAbandonedFiles();

    expect(abandonedFiles.error).toBeUndefined();
    expect(abandonedFiles.categories.find((c) => c.category === 'trials')?.error).toBeTruthy();
  });

  it('treats a folder that does not exist yet as empty, not as broken', async () => {
    // Nothing has been uploaded on a fresh install, and that is not a fault to report.
    readdir.mockRejectedValue(Object.assign(new Error('missing'), { code: 'ENOENT' }));

    const { abandonedFiles } = await collectAbandonedFiles();

    expect(abandonedFiles.total).toBe(0);
    expect(abandonedFiles.categories.every((c) => !c.error)).toBe(true);
  });
});

describe('what the volume holds, before asking what is reclaimable', () => {
  it('counts and measures the files that are still in use', async () => {
    // The working set is what says whether a filling disk is real work or rubbish, and those
    // two call for opposite responses.
    onDisk({ submissions: ['kept.jff', 'orphan.jff'] });
    prismaMock.submission.findMany.mockResolvedValue([{ fileName: 'kept.jff' }]);
    sized(4_096);

    const { storage } = await collectAbandonedFiles();
    const submissions = storage.categories.find((c) => c.category === 'submissions')!;

    expect(submissions).toMatchObject({
      inUseCount: 1,
      inUseBytes: 4_096,
      abandonedCount: 1,
      abandonedBytes: 4_096,
    });
    expect(storage.inUseCount).toBe(1);
    expect(storage.inUseBytes).toBe(4_096);
  });

  it('reports a row whose file is not on disk', async () => {
    // The opposite of an abandoned file and much worse: a submission whose file has gone cannot
    // be downloaded, re-graded or appealed, and nothing else in AFCT reports it.
    onDisk({ submissions: [] });
    prismaMock.submission.findMany.mockResolvedValue([
      { fileName: 'gone.jff' },
      { fileName: 'also-gone.jff' },
    ]);

    const { storage } = await collectAbandonedFiles();

    expect(storage.missingCount).toBe(2);
    expect(storage.categories.find((c) => c.category === 'submissions')?.missingSamples).toEqual([
      'also-gone.jff',
      'gone.jff',
    ]);
  });

  it('does not report missing files for a folder that shares another folder’s column', async () => {
    // Two folders are served from `Problem.fileName`, and the solutions folder is where those
    // files are. Counting a reference satisfied over there as missing here reported thirteen
    // imaginary missing files on a healthy install.
    onDisk({ solutions: ['s1.jff', 's2.jff'] });
    prismaMock.problem.findMany.mockResolvedValue([{ fileName: 's1.jff' }, { fileName: 's2.jff' }]);

    const { storage } = await collectAbandonedFiles();

    expect(storage.categories.find((c) => c.category === 'problems')?.missingCount).toBe(0);
    expect(storage.missingCount).toBe(0);
  });

  it('does not call every file missing when the folder cannot be read', async () => {
    // An unreadable folder holds no files as far as `readdir` is concerned, so counting its
    // rows as missing would turn one permissions problem into a page-wide false alarm.
    readdir.mockRejectedValue(Object.assign(new Error('denied'), { code: 'EACCES' }));
    prismaMock.submission.findMany.mockResolvedValue([{ fileName: 'present.jff' }]);

    const { storage } = await collectAbandonedFiles();

    expect(storage.missingCount).toBe(0);
    expect(storage.categories.find((c) => c.category === 'submissions')?.error).toBeTruthy();
  });

  it('reports the space left on the uploads disk', async () => {
    // Sizes only mean something against what is left; the deploy VM fills after about seven
    // upgrades, so free space is what decides whether any of this is urgent.
    statfs.mockResolvedValue({ blocks: 1_000, bavail: 250, bsize: 4_096 });

    const { storage } = await collectAbandonedFiles();

    expect(storage.volume).toEqual({ totalBytes: 4_096_000, freeBytes: 1_024_000 });
  });

  it('leaves the space unreported rather than guessing when it cannot be read', async () => {
    const { storage } = await collectAbandonedFiles();

    expect(storage.volume).toBeUndefined();
  });
});

describe('deleteAbandonedFilesInCategory', () => {
  it('deletes every abandoned file in the category and reports what it freed', async () => {
    onDisk({ submissions: ['a.jff', 'b.jff', 'c.jff'] });
    sized(2_000);

    const result = await deleteAbandonedFilesInCategory('submissions');

    expect(result).toEqual({ ok: true, deleted: 3, freedBytes: 6_000 });
    expect(unlink).toHaveBeenCalledTimes(3);
  });

  it('leaves files that are still in use, even while clearing the rest', async () => {
    onDisk({ submissions: ['kept.jff', 'orphan.jff'] });
    prismaMock.submission.findMany.mockResolvedValue([{ fileName: 'kept.jff' }]);

    const result = await deleteAbandonedFilesInCategory('submissions');

    expect(result).toMatchObject({ ok: true, deleted: 1 });
    expect(unlink).toHaveBeenCalledTimes(1);
    expect(unlink).toHaveBeenCalledWith('/private/uploads/submissions/orphan.jff');
  });

  it('keeps going when one file cannot be removed', async () => {
    // A partial clean-up is still a clean-up, and the count returned says what really happened.
    onDisk({ submissions: ['a.jff', 'b.jff'] });
    unlink.mockRejectedValueOnce(new Error('busy'));

    expect(await deleteAbandonedFilesInCategory('submissions')).toMatchObject({ deleted: 1 });
  });

  it('refuses a category it does not know', async () => {
    expect(await deleteAbandonedFilesInCategory('backups')).toMatchObject({ status: 400 });
    expect(unlink).not.toHaveBeenCalled();
  });
});

describe('deleteAbandonedFile', () => {
  it('deletes a trial file nothing points at', async () => {
    expect(await deleteAbandonedFile('trials', 'left-behind.jff')).toEqual({ ok: true });
    expect(unlink).toHaveBeenCalledWith('/private/uploads/trials/left-behind.jff');
  });

  it('refuses to delete a trial file a row still names', async () => {
    // Asked of the same source the report uses, so "still referenced" cannot mean one thing
    // when listing files and another when deleting one.
    prismaMock.evaluatorTrial.findMany.mockResolvedValue([
      { answerFileName: 'answer.jff', submissionFileName: null },
    ]);

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
