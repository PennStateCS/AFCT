import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The copy semantics four routes now share: duplicate a problem, import a problem,
 * duplicate an assignment with copies of its problems, import one.
 *
 * They used to hold four copies of this, identical down to the comments, so a column
 * added to Problem could be carried by one path and silently dropped by another. Testing
 * it here rather than only through the routes is the point: the routes prove they call it,
 * these prove what it does.
 */

const prismaMock = vi.hoisted(() => ({ problem: { create: vi.fn() } }));
const fsMock = vi.hoisted(() => ({
  existsSync: vi.fn(() => true),
  copyFile: vi.fn(() => Promise.resolve()),
  unlink: vi.fn(() => Promise.resolve()),
}));

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('fs', () => ({
  default: {
    existsSync: fsMock.existsSync,
    promises: { copyFile: fsMock.copyFile, unlink: fsMock.unlink },
  },
}));
vi.mock('@/lib/safe-upload', () => ({
  safeStoredFilename: (name: string) => `stored-${name}`,
  resolveInsideDir: (dir: string, name: string) => `${dir}/${name}`,
}));

import { copyAnswerKeysForProblems, copyProblemInto } from './problem-copy';

const source = {
  id: 'p1',
  fileName: 'old-stored.jff',
  originalFileName: 'even-length.jff',
  type: 'FA' as const,
  maxStates: 6,
  isDeterministic: true,
  // The answer key's fingerprints, which travel with the file they describe.
  answerContentHash: 'content-hash',
  answerShapeHash: 'shape-hash',
};

beforeEach(() => {
  vi.clearAllMocks();
  fsMock.existsSync.mockReturnValue(true);
  prismaMock.problem.create.mockImplementation(async ({ data }: { data: unknown }) => ({
    id: 'new-1',
    ...(data as object),
  }));
});

describe('copying one problem', () => {
  it('carries the parts of the problem that define it', async () => {
    await copyProblemInto({ source, courseId: 'c2', title: 'Copy' });

    expect(prismaMock.problem.create.mock.calls[0][0].data).toMatchObject({
      type: 'FA',
      maxStates: 6,
      isDeterministic: true,
      courseId: 'c2',
      title: 'Copy',
    });
  });

  /**
   * A fresh name, not the source's. Sharing the stored file would mean deleting either
   * problem takes the other one's answer key with it.
   */
  it('copies the answer key to a new name', async () => {
    const { copiedFileName } = await copyProblemInto({ source, courseId: 'c2', title: 'Copy' });

    expect(fsMock.copyFile).toHaveBeenCalledWith(
      '/private/uploads/solutions/old-stored.jff',
      '/private/uploads/solutions/stored-even-length.jff',
    );
    expect(copiedFileName).toBe('stored-even-length.jff');
    expect(prismaMock.problem.create.mock.calls[0][0].data.fileName).toBe(
      'stored-even-length.jff',
    );
  });

  it('keeps the display name the faculty member uploaded', async () => {
    await copyProblemInto({ source, courseId: 'c2', title: 'Copy' });

    expect(prismaMock.problem.create.mock.calls[0][0].data.originalFileName).toBe(
      'even-length.jff',
    );
  });

  it('copies nothing when the source has no answer key', async () => {
    await copyProblemInto({
      source: { ...source, fileName: null },
      courseId: 'c2',
      title: 'Copy',
    });

    expect(fsMock.copyFile).not.toHaveBeenCalled();
    expect(prismaMock.problem.create.mock.calls[0][0].data).toMatchObject({
      fileName: null,
      originalFileName: null,
    });
  });

  /**
   * A row pointing at a file that is not there. The copy gets no answer key rather than a
   * pointer to nothing, and the create still goes ahead.
   */
  it('leaves the copy without an answer key when the source file has gone missing', async () => {
    fsMock.existsSync.mockReturnValue(false);

    const { copiedFileName } = await copyProblemInto({ source, courseId: 'c2', title: 'Copy' });

    expect(copiedFileName).toBeNull();
    expect(fsMock.copyFile).not.toHaveBeenCalled();
    expect(prismaMock.problem.create.mock.calls[0][0].data.originalFileName).toBeNull();
  });

  /** The orphan guard: a file copied for a row that was never created is rubbish on disk. */
  it('removes the copied file when the row cannot be created', async () => {
    prismaMock.problem.create.mockRejectedValue(new Error('constraint'));

    await expect(copyProblemInto({ source, courseId: 'c2', title: 'Copy' })).rejects.toThrow(
      'constraint',
    );

    expect(fsMock.unlink).toHaveBeenCalledWith('/private/uploads/solutions/stored-even-length.jff');
  });

  it('has nothing to remove when the create fails and no file was copied', async () => {
    prismaMock.problem.create.mockRejectedValue(new Error('constraint'));

    await expect(
      copyProblemInto({ source: { ...source, fileName: null }, courseId: 'c2', title: 'Copy' }),
    ).rejects.toThrow('constraint');

    expect(fsMock.unlink).not.toHaveBeenCalled();
  });
});

describe('copying the answer keys for a whole assignment', () => {
  const problems = [
    { id: 'p1', fileName: 'a.jff', originalFileName: 'first.jff' },
    { id: 'p2', fileName: 'b.jff', originalFileName: 'second.jff' },
  ];

  it('returns one entry per problem, keyed by the source problem id', async () => {
    const { byProblemId } = await copyAnswerKeysForProblems(problems);

    expect([...byProblemId.keys()]).toEqual(['p1', 'p2']);
    expect(byProblemId.get('p1')).toEqual({
      fileName: 'stored-first.jff',
      originalFileName: 'first.jff',
    });
  });

  /** The caller unlinks these if its transaction fails, so every copy has to be reported. */
  it('reports every path it wrote', async () => {
    const { copiedPaths } = await copyAnswerKeysForProblems(problems);

    expect(copiedPaths).toEqual([
      '/private/uploads/solutions/stored-first.jff',
      '/private/uploads/solutions/stored-second.jff',
    ]);
  });

  it('still lists a problem whose file is missing, with no answer key', async () => {
    fsMock.existsSync.mockReturnValueOnce(false);

    const { byProblemId, copiedPaths } = await copyAnswerKeysForProblems(problems);

    expect(byProblemId.get('p1')).toEqual({ fileName: null, originalFileName: 'first.jff' });
    expect(copiedPaths).toHaveLength(1);
  });

  it('does nothing when the assignment has no problems', async () => {
    const { byProblemId, copiedPaths } = await copyAnswerKeysForProblems([]);

    expect(byProblemId.size).toBe(0);
    expect(copiedPaths).toEqual([]);
    expect(fsMock.copyFile).not.toHaveBeenCalled();
  });
});

describe('the answer key fingerprints', () => {
  /**
   * The hashes are what let the similarity check say a student handed in the instructor's own
   * solution. They are worked out when the file is uploaded, so a copy that took the file and
   * left them behind had an answer key the check could not recognise, in every duplicated or
   * imported course.
   */
  it('travel with the file they describe', async () => {
    await copyProblemInto({ source, courseId: 'c2', title: 'Copy' });

    expect(prismaMock.problem.create.mock.calls[0][0].data).toMatchObject({
      answerContentHash: 'content-hash',
      answerShapeHash: 'shape-hash',
    });
  });

  it('are left behind when there is no file to describe', async () => {
    await copyProblemInto({
      source: { ...source, fileName: null },
      courseId: 'c2',
      title: 'Copy',
    });

    expect(prismaMock.problem.create.mock.calls[0][0].data).toMatchObject({
      fileName: null,
      answerContentHash: null,
      answerShapeHash: null,
    });
  });

  it('are left behind when the source file has gone missing', async () => {
    fsMock.existsSync.mockReturnValue(false);

    await copyProblemInto({ source, courseId: 'c2', title: 'Copy' });

    expect(prismaMock.problem.create.mock.calls[0][0].data).toMatchObject({
      fileName: null,
      answerContentHash: null,
      answerShapeHash: null,
    });
  });
});
