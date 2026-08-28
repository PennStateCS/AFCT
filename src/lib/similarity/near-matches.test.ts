import { describe, expect, it } from 'vitest';
import { findNearMatches, type NearMatchInput } from './near-matches';
import { PROVENANCE_FEATURE_VERSION } from './provenance';

/**
 * Feature bags written by hand rather than extracted from XML: this module's job is the
 * comparing, and hand-written bags let a case say exactly what it is about. `provenance.test`
 * covers the extraction that produces them from real files.
 */
const bag = (features: string[], counts = { states: 4, transitions: 5 }) => ({
  version: PROVENANCE_FEATURE_VERSION,
  machineType: 'fa',
  stateCount: counts.states,
  transitionCount: counts.transitions,
  features,
});

let clock = 0;
const person = (
  id: string,
  features: string[],
  over: Partial<NearMatchInput> = {},
): NearMatchInput => ({
  id: `sub-${id}`,
  studentId: `student-${id}`,
  studentGroupId: null,
  submittedAt: new Date(Date.UTC(2026, 7, 15, 12, (clock += 7))),
  shapeKey: `shape-${id}`,
  features: bag(features),
  ...over,
});

/** Ten pieces of structure everybody's correct answer has. */
const ordinary = Array.from({ length: 10 }, (_, index) => `f:s:common-${index}`);
/**
 * Pieces only a shared origin would explain. Two of each family the evidence speaks about,
 * because one shared identifier pair or one shared step is a coincidence and the thresholds
 * say so.
 */
const peculiar = [
  'f:s:odd-dead-state',
  'f:e:odd-loop',
  't:4>7',
  't:7>4',
  'g:3,-2',
  'g:-1,5',
  'c:9,6',
];

/** A class of students who each solved it their own way. */
const crowd = (count: number) =>
  Array.from({ length: count }, (_, index) =>
    person(`crowd-${index}`, [...ordinary, `f:s:own-${index}`, `t:${index}>${index + 1}`]),
  );

describe('findNearMatches', () => {
  it('has nothing to say about a single submission', () => {
    expect(findNearMatches([person('a', ordinary)])).toEqual([]);
  });

  it('finds a pair sharing uncommon structure inside a class that does not', () => {
    const matches = findNearMatches([
      ...crowd(20),
      person('a', [...ordinary, ...peculiar]),
      person('b', [...ordinary, ...peculiar]),
    ]);

    expect(matches).toHaveLength(1);
    expect([matches[0]?.a.studentId, matches[0]?.b.studentId].sort()).toEqual([
      'student-a',
      'student-b',
    ]);
  });

  it('says nothing about a common correct answer that most of the class submitted', () => {
    // Twenty students with the identical ordinary description and nothing peculiar.
    const everybody = Array.from({ length: 20 }, (_, index) => person(`same-${index}`, ordinary));

    expect(findNearMatches(everybody)).toEqual([]);
  });

  it('treats a feature held by exactly a quarter of the class as common, not rare', () => {
    // Eight students, and the peculiar structure is held by two of them: exactly the 25%
    // boundary. The whole-answer rule (`isCommon`) calls that share common, and this one has
    // to agree, or the same number means two different things one level apart.
    const matches = findNearMatches([
      ...crowd(6),
      person('a', [...ordinary, ...peculiar]),
      person('b', [...ordinary, ...peculiar]),
    ]);

    expect(matches).toEqual([]);
  });

  it('still weighs a feature held by fewer than a quarter of the class', () => {
    // One more student, so the same two hold it at 2 in 9, and it carries rarity again.
    const matches = findNearMatches([
      ...crowd(7),
      person('a', [...ordinary, ...peculiar]),
      person('b', [...ordinary, ...peculiar]),
    ]);

    expect(matches).toHaveLength(1);
  });

  it('does not report a pair that the shape check already matched', () => {
    const shared = { shapeKey: 'the-same-shape' };
    const matches = findNearMatches([
      ...crowd(20),
      person('a', [...ordinary, ...peculiar], shared),
      person('b', [...ordinary, ...peculiar], shared),
    ]);

    expect(matches).toEqual([]);
  });

  it('does not report teammates on a group assignment', () => {
    const team = { studentGroupId: 'group-1' };
    const matches = findNearMatches([
      ...crowd(20),
      person('a', [...ordinary, ...peculiar], team),
      person('b', [...ordinary, ...peculiar], team),
    ]);

    expect(matches).toEqual([]);
  });

  it('does not pair a student with themselves', () => {
    const again = person('a', [...ordinary, ...peculiar], {
      id: 'sub-a2',
      submittedAt: new Date(Date.UTC(2026, 7, 15, 23, 0)),
    });

    expect(findNearMatches([person('a', [...ordinary, ...peculiar]), again])).toEqual([]);
  });

  it('compares every attempt, not only a student\'s first', () => {
    // Their first attempt is their own work; the copy arrives on the second.
    const firstTry = person('a', [...ordinary, 'f:s:my-own-attempt', 'f:e:my-own-attempt']);
    const later = person('a', [...ordinary, ...peculiar], {
      id: 'sub-a-later',
      submittedAt: new Date(Date.UTC(2026, 7, 15, 22, 0)),
    });

    const matches = findNearMatches([
      ...crowd(20),
      firstTry,
      later,
      person('b', [...ordinary, ...peculiar]),
    ]);

    expect(matches).toHaveLength(1);
    // And it is the attempt that actually matches which is reported, not the earlier one.
    expect([matches[0]?.a.id, matches[0]?.b.id]).toContain('sub-a-later');
  });

  it('gives two students one card, not one per pair of attempts', () => {
    const twice = (id: string) => [
      person(id, [...ordinary, ...peculiar]),
      person(id, [...ordinary, ...peculiar], {
        id: `sub-${id}-2`,
        submittedAt: new Date(Date.UTC(2026, 7, 15, 21, 0)),
      }),
    ];

    const matches = findNearMatches([...crowd(20), ...twice('a'), ...twice('b')]);

    expect(matches).toHaveLength(1);
  });

  it('will not pair submissions of different machine types', () => {
    const grammar = person('b', [...ordinary, ...peculiar]);
    grammar.features = { ...grammar.features, machineType: 'grammar' };

    expect(findNearMatches([...crowd(20), person('a', [...ordinary, ...peculiar]), grammar])).toEqual(
      [],
    );
  });

  it('needs more than one coincidence', () => {
    const matches = findNearMatches([
      ...crowd(20),
      person('a', [...ordinary, 'f:s:odd-dead-state']),
      person('b', [...ordinary, 'f:s:odd-dead-state']),
    ]);

    expect(matches).toEqual([]);
  });

  it('explains itself in statements a reader can check', () => {
    const [match] = findNearMatches([
      ...crowd(20),
      person('a', [...ordinary, ...peculiar]),
      person('b', [...ordinary, ...peculiar]),
    ]);

    const details = (match?.evidence ?? []).map((item) => item.detail);
    expect(details.some((line) => /pieces of local structure/.test(line))).toBe(true);
    expect(details.some((line) => /underlying identifiers/.test(line))).toBe(true);
    expect(details.some((line) => /relative to the rest of the drawing/.test(line))).toBe(true);
    expect(details.some((line) => /hand-adjusted curve/.test(line))).toBe(true);

    // Nothing that reads as a judgement, and no score.
    const text = details.join(' ').toLowerCase();
    for (const word of ['copied', 'cheat', 'plagiar', 'suspicious', 'likely', '%']) {
      expect(text).not.toContain(word);
    }
  });

  it('says when the two share the same mistake', () => {
    const odd = [...ordinary, 'u:dead:the-same-trap', 'f:s:odd-a', 'f:e:odd-b', 't:4>7', 't:7>4'];
    const [match] = findNearMatches([...crowd(20), person('a', odd), person('b', odd)]);

    expect((match?.evidence ?? []).map((item) => item.detail).join(' ')).toContain(
      'the same unusual feature',
    );
  });

  it('says when the same words were written on both drawings', () => {
    const written = [
      ...ordinary,
      'n:remember the epsilon',
      'l:start here',
      'f:s:odd-a',
      'f:e:odd-b',
    ];
    const [match] = findNearMatches([...crowd(20), person('a', written), person('b', written)]);

    expect((match?.evidence ?? []).map((item) => item.detail).join(' ')).toContain(
      'word for word the same',
    );
  });

  it('says when a machine is divided into the same building blocks', () => {
    const blocks = [
      ...ordinary,
      'b:shift-right',
      'b:shift-right:2,1',
      'b:shift-right:0>1',
      'f:s:odd-a',
    ];
    const [match] = findNearMatches([...crowd(20), person('a', blocks), person('b', blocks)]);

    expect((match?.evidence ?? []).map((item) => item.detail).join(' ')).toContain(
      'building-block details are the same',
    );
  });

  it('will not call two machines of very different sizes versions of each other', () => {
    const a = person('a', [...ordinary, ...peculiar]);
    const b = person('b', [...ordinary, ...peculiar]);
    // Four states against sixteen: whatever skeleton they share, these are two machines.
    b.features = { ...b.features, stateCount: 16, transitionCount: 20 };

    expect(findNearMatches([...crowd(20), a, b])).toEqual([]);
  });

  it('accepts the difference an edit actually makes', () => {
    const a = person('a', [...ordinary, ...peculiar]);
    const b = person('b', [...ordinary, ...peculiar]);
    // One state and one transition added, which is the case this check exists for.
    b.features = { ...b.features, stateCount: 5, transitionCount: 6 };

    expect(findNearMatches([...crowd(20), a, b])).toHaveLength(1);
  });

  it('says how the two differ, not only how they agree', () => {
    const a = person('a', [...ordinary, ...peculiar]);
    const b = person('b', [...ordinary, ...peculiar]);
    b.features = { ...b.features, transitionCount: 6 };

    const [match] = findNearMatches([...crowd(20), a, b]);

    expect((match?.evidence ?? []).map((item) => item.detail)).toContain(
      'They differ by 1 transition',
    );
  });

  it('ranks the pair sharing more uncommon structure first', () => {
    const matches = findNearMatches([
      ...crowd(20),
      person('a', [...ordinary, ...peculiar]),
      person('b', [...ordinary, ...peculiar]),
      person('c', [...ordinary, 'f:s:other-1', 'f:s:other-2', 'f:e:other-3', 't:8>9']),
      person('d', [...ordinary, 'f:s:other-1', 'f:s:other-2', 'f:e:other-3', 't:8>9']),
    ]);

    expect(matches.length).toBeGreaterThanOrEqual(2);
    expect([matches[0]?.a.studentId, matches[0]?.b.studentId].sort()).toEqual([
      'student-a',
      'student-b',
    ]);
  });
});
