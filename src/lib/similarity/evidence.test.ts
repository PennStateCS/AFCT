import { describe, expect, it } from 'vitest';
import {
  clusterMatches,
  countByType,
  displayTypeOf,
  matchTypeOf,
  summarise,
  DISPLAY_STRENGTH_OF,
  STRENGTH_OF,
} from './evidence';
import type { SubmissionMatchGroup } from './matches';

const submission = (
  studentId: string,
  at = '2026-08-15T12:00:00.000Z',
  // Which set of byte-identical files this one is in, as the API labels them. The default
  // fixture is one set; a case about files that merely normalise alike passes its own, and
  // null is a file stored before it was ever hashed.
  byteKey: string | null = 'b1',
) => ({
  id: `sub-${studentId}-${at}`,
  submittedAt: at,
  correct: true,
  attempt: 1,
  assignmentId: 'a1',
  fileName: `${studentId}.jff`,
  originalFileName: `${studentId}.jff`,
  contentKey: 'aaaa1111',
  byteKey,
  student: {
    id: studentId,
    firstName: studentId,
    lastName: 'Student',
    avatar: null,
    cropX: null,
    cropY: null,
    zoom: null,
  },
  studentGroup: null,
});

const group = (over: Partial<SubmissionMatchGroup> = {}): SubmissionMatchGroup =>
  ({
    matchId: 'm1',
    kind: 'same-work',
    evidence: [],
    stateCount: 9,
    transitionCount: 17,
    problem: { id: 'p1', title: 'Ends in 01', type: 'FA' },
    studentCount: 2,
    byteIdenticalStudentCount: 1,
    problemStudentCount: 84,
    identicalStudentCount: 2,
    closestGapMs: 7 * 60 * 1000,
    reusedAfterPass: false,
    matchesAnswerFile: false,
    submissions: [submission('a'), submission('b', '2026-08-15T12:07:00.000Z')],
    ...over,
  }) as SubmissionMatchGroup;

describe('matchTypeOf', () => {
  it('calls a group where everyone sent the same artifact exact, and rates it highest', () => {
    const type = matchTypeOf(group(), 0.25);
    expect(type).toBe('exact');
    expect(STRENGTH_OF[type]).toBe('very-strong');
  });

  it('calls a partly-identical group the same machine, one step down', () => {
    const type = matchTypeOf(group({ studentCount: 3, identicalStudentCount: 2 }), 0.25);
    expect(type).toBe('same-machine');
    expect(STRENGTH_OF[type]).toBe('strong');
  });

  it('calls a provenance match structural, weaker again', () => {
    const type = matchTypeOf(group({ kind: 'near', identicalStudentCount: 1 }), 0.25);
    expect(type).toBe('structural');
    expect(STRENGTH_OF[type]).toBe('possible');
  });

  it('calls work that is the posted solution a reference match, carrying no strength', () => {
    // Would otherwise be exact: everybody who was handed the file has the same artifact, so
    // how alike the artifacts are measures the handout rather than the students.
    const asExact = matchTypeOf(group({ matchesAnswerFile: true }), 0.25);
    expect(asExact).toBe('reference');
    expect(STRENGTH_OF[asExact]).toBe('none');

    // And the same when the students edited it enough to be only the same machine.
    const asSameMachine = matchTypeOf(
      group({ matchesAnswerFile: true, studentCount: 3, identicalStudentCount: 2 }),
      0.25,
    );
    expect(asSameMachine).toBe('reference');
  });

  it('still calls a widely shared posted solution a common answer, so the dial keeps meaning', () => {
    const type = matchTypeOf(
      group({ matchesAnswerFile: true, studentCount: 42, identicalStudentCount: 42 }),
      0.25,
    );
    expect(type).toBe('common');
  });

  it('calls anything most of the class shares common, whatever the files look like', () => {
    // An exact artifact shared by half the class is convergence, not a finding.
    const type = matchTypeOf(group({ studentCount: 42, identicalStudentCount: 42 }), 0.25);
    expect(type).toBe('common');
    expect(STRENGTH_OF[type]).toBe('none');
  });
});

describe('clusterMatches', () => {
  it('leaves an isolated pair as a group of two', () => {
    const [cluster, ...rest] = clusterMatches([group()], 0.25);

    expect(rest).toHaveLength(0);
    expect(cluster?.students).toHaveLength(2);
    expect(cluster?.relationships).toHaveLength(1);
  });

  it('folds relationships that share a student into one group', () => {
    // A↔B, A↔C, B↔C: three pairs, one set of three students, one card.
    const clusters = clusterMatches(
      [
        group({ matchId: 'ab', submissions: [submission('a'), submission('b')] }),
        group({ matchId: 'ac', submissions: [submission('a'), submission('c')] }),
        group({ matchId: 'bc', submissions: [submission('b'), submission('c')] }),
      ],
      0.25,
    );

    expect(clusters).toHaveLength(1);
    expect(clusters[0]?.students.map((s) => s.student.id).sort()).toEqual(['a', 'b', 'c']);
    expect(clusters[0]?.relationships).toHaveLength(3);
  });

  it('keeps unrelated students in separate groups', () => {
    const clusters = clusterMatches(
      [
        group({ matchId: 'ab', submissions: [submission('a'), submission('b')] }),
        group({ matchId: 'cd', submissions: [submission('c'), submission('d')] }),
      ],
      0.25,
    );

    expect(clusters).toHaveLength(2);
  });

  it('never folds a common answer into a group of real findings', () => {
    const clusters = clusterMatches(
      [
        group({ matchId: 'ab', submissions: [submission('a'), submission('b')] }),
        group({
          matchId: 'common',
          studentCount: 42,
          identicalStudentCount: 42,
          submissions: [submission('a'), submission('z')],
        }),
      ],
      0.25,
    );

    expect(clusters.map((cluster) => cluster.type).sort()).toEqual(['common', 'exact']);
  });

  it("takes the strongest evidence in a group as the group's own", () => {
    const [cluster] = clusterMatches(
      [
        group({
          matchId: 'weak',
          kind: 'near',
          identicalStudentCount: 1,
          submissions: [submission('a'), submission('b')],
        }),
        group({ matchId: 'strong', submissions: [submission('b'), submission('c')] }),
      ],
      0.25,
    );

    expect(cluster?.type).toBe('exact');
    expect(cluster?.counts).toEqual({
      'byte-identical': 1,
      exact: 0,
      'same-machine': 0,
      structural: 1,
      reference: 0,
    });
  });

  it('keeps the posted solution at the level it is true at', () => {
    // One pair is the instructor's file; the other pair, connected through b, is not. The
    // group as a whole is therefore NOT the reference solution, and saying so would excuse a
    // match nobody checked.
    const [cluster] = clusterMatches(
      [
        group({
          matchId: 'ab',
          matchesAnswerFile: true,
          submissions: [submission('a'), submission('b')],
        }),
        group({ matchId: 'bc', submissions: [submission('b'), submission('c')] }),
      ],
      0.25,
    );

    expect(cluster?.matchesAnswerFile).toBe(false);
    expect(cluster?.answerFileRelationships).toBe(1);

    // A group where every relationship is the posted solution can say it plainly.
    const [all] = clusterMatches(
      [
        group({
          matchId: 'ab',
          matchesAnswerFile: true,
          submissions: [submission('a'), submission('b')],
        }),
        group({
          matchId: 'bc',
          matchesAnswerFile: true,
          submissions: [submission('b'), submission('c')],
        }),
      ],
      0.25,
    );
    expect(all?.matchesAnswerFile).toBe(true);
  });

  it('carries the timing and reuse of everything in the group', () => {
    const [cluster] = clusterMatches(
      [
        group({
          matchId: 'one',
          closestGapMs: 60_000,
          submissions: [submission('a'), submission('b')],
        }),
        group({
          matchId: 'two',
          closestGapMs: 20 * 60_000,
          reusedAfterPass: true,
          submissions: [submission('b'), submission('c')],
        }),
      ],
      0.25,
    );

    expect(cluster?.closestGapMs).toBe(60_000);
    expect(cluster?.reusedAfterPass).toBe(true);
    expect(cluster?.earliest?.student.id).toBe('a');
  });

  it('puts the strongest evidence at the top of the page', () => {
    const clusters = clusterMatches(
      [
        group({
          matchId: 'near',
          kind: 'near',
          identicalStudentCount: 1,
          submissions: [submission('x'), submission('y')],
        }),
        group({
          matchId: 'common',
          studentCount: 42,
          identicalStudentCount: 42,
          submissions: [submission('m'), submission('n')],
        }),
        group({ matchId: 'exact', submissions: [submission('a'), submission('b')] }),
        group({
          matchId: 'shape',
          studentCount: 3,
          identicalStudentCount: 2,
          submissions: [submission('c'), submission('d')],
        }),
      ],
      0.25,
    );

    expect(clusters.map((cluster) => cluster.type)).toEqual([
      'exact',
      'same-machine',
      'structural',
      'common',
    ]);
  });

  it('lifts reuse after passing above its equals, not above stronger evidence', () => {
    const clusters = clusterMatches(
      [
        group({ matchId: 'plain-exact', submissions: [submission('a'), submission('b')] }),
        group({
          matchId: 'reused-near',
          kind: 'near',
          identicalStudentCount: 1,
          reusedAfterPass: true,
          submissions: [submission('x'), submission('y')],
        }),
        group({
          matchId: 'reused-exact',
          reusedAfterPass: true,
          submissions: [submission('c'), submission('d')],
        }),
      ],
      0.25,
    );

    expect(clusters.map((cluster) => cluster.id.split(':')[1])).toBeDefined();
    expect(clusters[0]?.type).toBe('exact');
    expect(clusters[0]?.reusedAfterPass).toBe(true);
    expect(clusters[2]?.type).toBe('structural');
  });
});

describe('displayTypeOf', () => {
  it('calls a match where every file agrees to the byte what it is', () => {
    const type = displayTypeOf(group(), 0.25);
    expect(type).toBe('byte-identical');
    // The same rung as an exact artifact, said more precisely, not a new tier above it.
    expect(DISPLAY_STRENGTH_OF[type]).toBe('very-strong');
  });

  it('says it of three files as readily as of two', () => {
    const three = group({
      studentCount: 3,
      identicalStudentCount: 3,
      submissions: [submission('a'), submission('b'), submission('c')],
    });

    expect(displayTypeOf(three, 0.25)).toBe('byte-identical');
  });

  it('stays an exact artifact when the files only agree once formatting is ignored', () => {
    const normalised = group({
      submissions: [submission('a', undefined, 'b1'), submission('b', undefined, 'b2')],
    });

    expect(displayTypeOf(normalised, 0.25)).toBe('exact');
  });

  it('stays an exact artifact when a raw file was never hashed', () => {
    // Null is "not known", not "different": the claim is blocked, not contradicted.
    const unhashed = group({
      submissions: [submission('a', undefined, null), submission('b', undefined, null)],
    });
    expect(displayTypeOf(unhashed, 0.25)).toBe('exact');

    const half = group({
      submissions: [submission('a'), submission('b', undefined, null)],
    });
    expect(displayTypeOf(half, 0.25)).toBe('exact');
  });

  it('does not promote a match where only some of the files agree to the byte', () => {
    // a and b are the same file; c is the same artifact once formatting is ignored. The
    // badge speaks for the whole relationship, so it stays at what covers all three, and
    // who the stronger fact is about is said in the relationship's own details.
    const partial = group({
      studentCount: 3,
      identicalStudentCount: 3,
      submissions: [submission('a'), submission('b'), submission('c', undefined, 'b2')],
    });

    expect(displayTypeOf(partial, 0.25)).toBe('exact');
  });

  it('leaves every other kind exactly where it was', () => {
    // Same machine, structural, the posted solution and a common answer are all unchanged by
    // raw equality: the first two cannot be byte-equal, and the last two are explained by
    // something other than how alike the files are.
    expect(displayTypeOf(group({ studentCount: 3, identicalStudentCount: 2 }), 0.25)).toBe(
      'same-machine',
    );
    expect(displayTypeOf(group({ kind: 'near', identicalStudentCount: 1 }), 0.25)).toBe(
      'structural',
    );
    expect(displayTypeOf(group({ matchesAnswerFile: true }), 0.25)).toBe('reference');
    expect(displayTypeOf(group({ studentCount: 42, identicalStudentCount: 42 }), 0.25)).toBe(
      'common',
    );
  });
});

describe('clusterMatches, on byte-identical relationships', () => {
  it('labels a group where every relationship agrees to the byte', () => {
    const [cluster] = clusterMatches(
      [
        group({ matchId: 'ab', submissions: [submission('a'), submission('b')] }),
        group({ matchId: 'bc', submissions: [submission('b'), submission('c')] }),
      ],
      0.25,
    );

    expect(cluster?.homogeneous).toBe(true);
    expect(cluster?.displayType).toBe('byte-identical');
    expect(cluster?.counts['byte-identical']).toBe(2);
  });

  it('stays neutral where one relationship is byte-equal and another only normalises alike', () => {
    // Alice and Bob sent the same file; Bob and Carol sent the same artifact saved
    // differently. Neither statement is true of all three, so the group makes neither.
    const [cluster] = clusterMatches(
      [
        group({ matchId: 'ab', submissions: [submission('alice'), submission('bob')] }),
        group({
          matchId: 'bc',
          submissions: [submission('bob', undefined, 'b1'), submission('carol', undefined, 'b2')],
        }),
      ],
      0.25,
    );

    expect(cluster?.homogeneous).toBe(false);
    expect(cluster?.type).toBe('exact');
    expect(cluster?.counts).toEqual({
      'byte-identical': 1,
      exact: 1,
      'same-machine': 0,
      structural: 0,
      reference: 0,
    });
  });
});

describe('summarise', () => {
  it('counts groups rather than pairs, and says when any are exact', () => {
    // Files that normalise alike without being byte-equal, so what is counted here is the
    // exact-artifact line rather than the stronger one below it.
    const clusters = clusterMatches(
      [
        group({
          matchId: 'ab',
          submissions: [submission('a', undefined, 'b1'), submission('b', undefined, 'b2')],
        }),
        group({
          matchId: 'ac',
          submissions: [submission('a', undefined, 'b1'), submission('c', undefined, 'b3')],
        }),
        group({
          matchId: 'xy',
          kind: 'near',
          identicalStudentCount: 1,
          submissions: [submission('x'), submission('y')],
        }),
      ],
      0.25,
    );

    const lines = summarise(clusters);
    expect(lines[0]).toBe('2 match groups worth reviewing across 1 problem.');
    expect(lines).toContain('1 contains an exact artifact match.');
    // The pair count is kept, but as secondary information.
    expect(lines).toContain('3 similarity relationships are contained in these groups.');
  });

  it('says byte-for-byte identical work separately from an exact artifact', () => {
    const clusters = clusterMatches(
      [
        // One group whose files are identical to the byte.
        group({ matchId: 'ab', submissions: [submission('a'), submission('b')] }),
        // One whose files only normalise alike, in another problem so it stays its own group.
        group({
          matchId: 'xy',
          problem: { id: 'p2', title: 'a^n b^n', type: 'CFG' },
          submissions: [submission('x', undefined, 'b1'), submission('y', undefined, 'b2')],
        }),
      ],
      0.25,
    );

    const lines = summarise(clusters);
    expect(lines).toContain('1 contains a byte-for-byte identical match.');
    expect(lines).toContain('1 contains an exact artifact match.');
  });

  it('does not count common answers as worth reviewing', () => {
    const clusters = clusterMatches(
      [group({ matchId: 'common', studentCount: 42, identicalStudentCount: 42 })],
      0.25,
    );

    expect(summarise(clusters)[0]).toBe(
      'No matches worth reviewing. 1 group set aside as a common answer or the posted solution.',
    );
    expect(countByType(clusters)).toMatchObject({ all: 1, common: 1, exact: 0 });
  });

  it('says so plainly when there is nothing at all', () => {
    expect(summarise([])).toEqual(['No two students submitted related work.']);
  });
});
