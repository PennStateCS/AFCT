/**
 * What a seeded answer has to be true of.
 *
 * The seed exists to demonstrate the Similarity report, so its answers have to carry the
 * relationships the report tells apart: the same file, the same machine drawn differently, a copy
 * with one thing changed, and independent work. Those are properties, not counts, and both bugs
 * found reviewing this code were breaches of one:
 *
 * - `ownAttempt` listed `[0-9]` among its regular expressions, which is the posted answer itself,
 *   so one student in six sent a file identical to the solution and joined the copied pair.
 * - `ownAttempt` picked from its lists with `variant % list.length` while variants advanced by a
 *   stride of five and the list held five, so the choice stopped depending on the student at all
 *   and fourteen of eighteen landed in one match group.
 *
 * Neither is visible by reading the code, and neither breaks anything that would fail loudly: the
 * seed runs, the counts look plausible, and the report quietly stops demonstrating the thing it
 * is there to demonstrate. Hence properties asserted against the real sample files, using the
 * app's own hashing, rather than fixtures.
 */

import { describe, expect, it } from 'vitest';
import { submissionContentHash, submissionShapeHash } from '@/lib/similarity/content-hash';
import { choose, editOneTransition, loadSamples, ownAttempt, redraw } from './seed-answers';

const samples = await loadSamples();

/** One representative file per problem type, named so a failure says which type broke. */
const byType = [...samples.entries()].map(([type, files]) => ({
  type,
  name: [...files.keys()][0]!,
  content: [...files.values()][0]!,
}));

const content = (text: string) => submissionContentHash(text);
const shape = (text: string) => submissionShapeHash(text);

/** How many students the seed can put on one problem, which bounds the variants in play. */
const VARIANTS = Array.from({ length: 60 }, (_, i) => i);

describe('the sample files behind seeded answers', () => {
  it('covers every problem type AFCT grades', () => {
    expect([...samples.keys()].sort()).toEqual(['CFG', 'FA', 'PDA', 'RE', 'TM']);
  });
});

describe.each(byType)('$type answers (from $name)', ({ content: base }) => {
  it('never passes off the posted solution as a student’s own work', () => {
    // The one property that makes a planted match mean anything: independent work has to be
    // independent. When this broke, the copied pair became indistinguishable from the class.
    const canonical = content(base);
    for (const variant of VARIANTS) {
      expect(content(ownAttempt(base, variant))).not.toBe(canonical);
    }
  });

  it('does not hand the same answer to every student', () => {
    // Consecutive variants belong to different students. If the choice collapses onto a small set
    // the cohort turns into one match group, which is what a stride sharing a factor with the
    // answer list did.
    const distinct = new Set(VARIANTS.map((variant) => content(ownAttempt(base, variant))));
    expect(distinct.size).toBeGreaterThan(3);
  });

  it('gives a student the same file for the same variant, every run', () => {
    expect(content(ownAttempt(base, 7))).toBe(content(ownAttempt(base, 7)));
  });

  it('changes both fingerprints when a copy is edited', () => {
    // A copy somebody altered is a different file and a different machine; only the provenance
    // features can still connect it, which is why that third fingerprint exists.
    const edited = editOneTransition(base);
    expect(content(edited)).not.toBe(content(base));
    if (shape(base) !== null) expect(shape(edited)).not.toBe(shape(base));
  });
});

describe('redrawing: the same machine, moved and renamed', () => {
  // A regular expression has no layout to move, so it is excluded here and covered below. That
  // is a fact about the artifact, not a gap in the seed.
  const withLayout = byType.filter(({ type }) => type !== 'RE');

  it.each(withLayout)(
    '$type keeps the shape hash and changes the content hash',
    ({ content: base }) => {
      const redrawn = redraw(base, 1);
      expect(content(redrawn)).not.toBe(content(base));
      expect(shape(redrawn)).toBe(shape(base));
    },
  );

  it.each(withLayout)('$type never redraws back into the posted solution', ({ content: base }) => {
    // A grammar has only as many orderings as it has productions, so the rotation must skip the
    // identity one. Without that, a student who reordered nothing looked like they had copied.
    for (const offset of VARIANTS) {
      expect(content(redraw(base, offset))).not.toBe(content(base));
    }
  });

  it('leaves a regular expression alone, because there is nothing incidental in one', () => {
    const re = byType.find(({ type }) => type === 'RE')!;
    expect(redraw(re.content, 3)).toBe(re.content);
  });
});

describe('choose', () => {
  it('spreads consecutive variants across the list', () => {
    // The failing case exactly: a stride equal to the list length. `variant % length` returned
    // the same entry for every student, and this is the assertion that would have said so.
    const list = ['a', 'b', 'c', 'd', 'e'];
    const stride5 = Array.from({ length: 12 }, (_, student) => choose(list, student * 5 + 1));
    expect(new Set(stride5).size).toBeGreaterThan(1);
  });

  it('uses the whole list rather than favouring one end', () => {
    const list = ['a', 'b', 'c', 'd', 'e', 'f'];
    const seen = new Set(VARIANTS.map((variant) => choose(list, variant)));
    expect(seen.size).toBe(list.length);
  });

  it('is stable, so a seeded database is the same on two machines', () => {
    const list = ['a', 'b', 'c'];
    expect(VARIANTS.map((v) => choose(list, v))).toEqual(VARIANTS.map((v) => choose(list, v)));
  });
});
