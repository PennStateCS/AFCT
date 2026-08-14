import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

/**
 * The similarity report: the hashes taken off a submitted file, and who else has submitted one
 * like it.
 *
 * This module had **no tests at all**, and the submission worker's own suite mocks both of its
 * entry points, so nothing anywhere exercised it. It runs on every submission and its output is
 * plagiarism evidence about students, which makes "nobody has ever checked what it does" the
 * wrong state for it to be in.
 *
 * The first block below is why it mattered: the parser gives up on ordinary input, and what it
 * returns then is exactly what `check_file_status` refuses to accept.
 */

const prismaMock = vi.hoisted(() => ({
  submission: { findMany: vi.fn() },
  user: { findUnique: vi.fn() },
}));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('../prisma', () => ({ prisma: prismaMock }));

import { jflapSimilarityParser } from './jflap_simulatiry_parser';
import { check_file_status } from './check_file_status';
import { get_info_from_hash } from './get_info_from_hash';

let dir = '';

/** A minimal JFLAP file. The parser hashes the `<structure>` element and nothing else. */
const JFF = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<structure>
  <type>fa</type>
  <automaton>
    <state id="0" name="q0"><x>100</x><y>100</y><initial/></state>
  </automaton>
</structure>`;

async function writeFixture(name: string, contents: string): Promise<string> {
  const file = path.join(dir, name);
  await writeFile(file, contents, 'utf8');
  return file;
}

beforeEach(async () => {
  vi.clearAllMocks();
  prismaMock.submission.findMany.mockResolvedValue([]);
  prismaMock.user.findUnique.mockResolvedValue({ email: 'student@example.test' });
  dir = await mkdtemp(path.join(tmpdir(), 'afct-similarity-'));
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

/**
 * What the parser hands on when it cannot do its job, and what the checker does with it.
 *
 * Read together these two are the bug: the parser reports failure as `null` or an undefined
 * hash, and the checker treats an undefined hash as grounds to throw. In the worker that throw
 * used to land in the evaluator's catch and mark an already-graded submission FAILED.
 */
describe('what happens when the file cannot be read', () => {
  it('gives up on a file that is not a .jff', async () => {
    const file = await writeFixture('answer.txt', 'not an automaton');

    expect(await jflapSimilarityParser(file)).toBeNull();
  });

  it('gives up on an empty file', async () => {
    const file = await writeFixture('empty.jff', '');

    expect(await jflapSimilarityParser(file)).toBeNull();
  });

  it('gives up on a file that is not there', async () => {
    expect(await jflapSimilarityParser(path.join(dir, 'missing.jff'))).toBeNull();
  });

  // Valid XML, no automaton in it. The parser returns a shape, with the one field the checker
  // insists on left undefined.
  it('leaves the calculated hash undefined when there is no structure element', async () => {
    const file = await writeFixture('nostructure.jff', '<?xml version="1.0"?><other></other>');

    const parsed = await jflapSimilarityParser(file);

    expect(parsed).not.toBeNull();
    expect(parsed?.calcHashData).toBeUndefined();
  });

  /** The other half of the chain, and the reason the worker now guards this call. */
  it('refuses to report on a file it has no hash for', async () => {
    await expect(check_file_status(undefined, undefined, undefined, 'u-1')).rejects.toThrow(
      /Calculated hash is undefined/,
    );
  });
});

describe('reading a JFLAP file', () => {
  it('hashes the structure element', async () => {
    const file = await writeFixture('good.jff', JFF);

    const parsed = await jflapSimilarityParser(file);

    expect(parsed?.calcHashData).toMatch(/^[0-9a-f]{64}$/);
  });

  /**
   * The same automaton with trailing whitespace is the same automaton. The hash is taken off the
   * serialised structure element, so what follows it must not change the answer, or a file that
   * had a hash comment appended would stop matching the one it came from.
   */
  it('gives the same hash when only the trailing whitespace differs', async () => {
    const a = await writeFixture('a.jff', JFF);
    const b = await writeFixture('b.jff', `${JFF}\n   \n`);

    const first = await jflapSimilarityParser(a);
    const second = await jflapSimilarityParser(b);

    expect(first?.calcHashData).toBe(second?.calcHashData);
  });

  /**
   * A blank line before the XML declaration, on the other hand, produces no hash at all. That is
   * invalid XML rather than a parser shortcoming, and JFLAP does not write it, but a file edited
   * by hand can carry it. Recorded because of where it leads: an undefined hash is exactly what
   * `check_file_status` throws on, and before the worker guarded that call this file would have
   * failed a submission the evaluator had already graded.
   */
  it('produces no hash when a blank line precedes the XML declaration', async () => {
    const file = await writeFixture('leading.jff', `\n\n${JFF}`);

    const parsed = await jflapSimilarityParser(file);

    expect(parsed?.calcHashData).toBeUndefined();
  });

  it('gives different hashes for different automata', async () => {
    const a = await writeFixture('a.jff', JFF);
    const b = await writeFixture('b.jff', JFF.replace('q0', 'q1'));

    const first = await jflapSimilarityParser(a);
    const second = await jflapSimilarityParser(b);

    expect(first?.calcHashData).not.toBe(second?.calcHashData);
  });

  /**
   * The trailing comment tags are what a file carries from a previous download: the hash it had
   * when it left AFCT, and whose it was. They are read off the last two lines.
   */
  it('reads the hashes a previous download left in the file', async () => {
    const file = await writeFixture(
      'stamped.jff',
      `${JFF}\n<!--hashE:abc123-->\n<!--hashD:def456-->`,
    );

    const parsed = await jflapSimilarityParser(file);

    expect(parsed?.fileHashEmail).toBe('abc123');
    expect(parsed?.fileHashData).toBe('def456');
  });

  it('leaves them undefined when the file carries none', async () => {
    const file = await writeFixture('bare.jff', JFF);

    const parsed = await jflapSimilarityParser(file);

    expect(parsed?.fileHashEmail).toBeUndefined();
    expect(parsed?.fileHashData).toBeUndefined();
  });
});

/**
 * Who else has submitted this file.
 *
 * The codes are the whole output of this function and they are easy to get backwards: the
 * docblock on `check_file_status` had 0 and 1 the wrong way round until this was written, which
 * would have had somebody reading "nobody submitted this" as "only this student did".
 */
describe('who else submitted the same file', () => {
  it('says nobody when no submission carries the hash', async () => {
    prismaMock.submission.findMany.mockResolvedValue([]);

    expect(await get_info_from_hash('hash-1', 'u-1')).toMatchObject({ code: 0 });
  });

  it('says only this student when the only match is their own', async () => {
    prismaMock.submission.findMany.mockResolvedValue([{ studentId: 'u-1', id: 's-1' }]);

    expect(await get_info_from_hash('hash-1', 'u-1')).toMatchObject({ code: 1 });
  });

  /** The one that matters: somebody else has submitted the same automaton. */
  it('says somebody else when another student matches', async () => {
    prismaMock.submission.findMany.mockResolvedValue([
      { studentId: 'u-1', id: 's-1' },
      { studentId: 'u-2', id: 's-2' },
    ]);

    const result = await get_info_from_hash('hash-1', 'u-1');

    expect(result.code).toBe(2);
    expect(result.ids.user_ids).toEqual(['u-1', 'u-2']);
  });

  // Several submissions from one student are still one student, not a match.
  it('counts a student once however many times they submitted', async () => {
    prismaMock.submission.findMany.mockResolvedValue([
      { studentId: 'u-1', id: 's-1' },
      { studentId: 'u-1', id: 's-2' },
    ]);

    const result = await get_info_from_hash('hash-1', 'u-1');

    expect(result.code).toBe(1);
    expect(result.ids.user_ids).toEqual(['u-1']);
    expect(result.ids.submission_ids).toEqual(['s-1', 's-2']);
  });

  // No hash means no question was asked, which is not the same as "nobody matched".
  it('asks nothing of the database when there is no hash', async () => {
    const result = await get_info_from_hash(undefined, 'u-1');

    expect(result.code).toBeNull();
    expect(prismaMock.submission.findMany).not.toHaveBeenCalled();
  });
});

describe('the report as a whole', () => {
  it('compares the file’s own hash against the one calculated from it', async () => {
    const report = await check_file_status('same-hash', 'same-hash', undefined, 'u-1');

    expect(report.hash_data_match).toBe(true);
  });

  /**
   * The interesting case for a marker: the file says it hashes to one thing and it does not.
   * That is a file whose contents changed after it left AFCT.
   */
  it('notices when the file’s stored hash no longer matches its contents', async () => {
    const report = await check_file_status('old-hash', 'new-hash', undefined, 'u-1');

    expect(report.hash_data_match).toBe(false);
  });

  it('leaves the comparison unanswered when the file carried no hash', async () => {
    const report = await check_file_status(undefined, 'calc', undefined, 'u-1');

    expect(report.hash_data_match).toBeNull();
    expect(report.file_hash_code).toBeNull();
  });

  /** Whether the file came from the student submitting it, by the email hash it carries. */
  it('recognises the submitter’s own file', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ email: 'student@example.test' });
    const { createHash } = await import('node:crypto');
    const theirs = createHash('sha256').update('student@example.test').digest('hex');

    const report = await check_file_status(undefined, 'calc', theirs, 'u-1');

    expect(report.is_user_hash).toBe(true);
    expect(report.hash_email_match).toBe(true);
  });

  it('notices a file stamped with somebody else’s address', async () => {
    const report = await check_file_status(undefined, 'calc', 'a-different-hash', 'u-1');

    expect(report.is_user_hash).toBe(false);
  });

  // An account with no address is a real state, and it must not throw here.
  it('copes with a student who has no email address', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ email: null });

    const report = await check_file_status(undefined, 'calc', undefined, 'u-1');

    expect(report.calc_hash_email).toBeNull();
  });
});
