import { describe, expect, it } from 'vitest';
import {
  clusterMatches,
  countByType,
  matchTypeOf,
  summarise,
  STRENGTH_OF,
} from './evidence';
import type { SubmissionMatchGroup } from './matches';

const submission = (studentId: string, at = '2026-08-15T12:00:00.000Z') => ({
  id: `sub-${studentId}-${at}`,
  submittedAt: at,
  correct: true,
  attempt: 1,
  assignmentId: 'a1',
  fileName: `${studentId}.jff`,
  originalFileName: `${studentId}.jff`,
  contentKey: 'aaaa1111',
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

  it('takes the strongest evidence in a group as the group\'s own', () => {
    const [cluster] = clusterMatches(
      [
        group({ matchId: 'weak', kind: 'near', identicalStudentCount: 1, submissions: [submission('a'), submission('b')] }),
        group({ matchId: 'strong', submissions: [submission('b'), submission('c')] }),
      ],
      0.25,
    );

    expect(cluster?.type).toBe('exact');
    expect(cluster?.counts).toEqual({ exact: 1, 'same-machine': 0, structural: 1 });
  });

  it('carries the timing and reuse of everything in the group', () => {
    const [cluster] = clusterMatches(
      [
        group({ matchId: 'one', closestGapMs: 60_000, submissions: [submission('a'), submission('b')] }),
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
        group({ matchId: 'near', kind: 'near', identicalStudentCount: 1, submissions: [submission('x'), submission('y')] }),
        group({ matchId: 'common', studentCount: 42, identicalStudentCount: 42, submissions: [submission('m'), submission('n')] }),
        group({ matchId: 'exact', submissions: [submission('a'), submission('b')] }),
        group({ matchId: 'shape', studentCount: 3, identicalStudentCount: 2, submissions: [submission('c'), submission('d')] }),
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

describe('summarise', () => {
  it('counts groups rather than pairs, and says when any are exact', () => {
    const clusters = clusterMatches(
      [
        group({ matchId: 'ab', submissions: [submission('a'), submission('b')] }),
        group({ matchId: 'ac', submissions: [submission('a'), submission('c')] }),
        group({ matchId: 'xy', kind: 'near', identicalStudentCount: 1, submissions: [submission('x'), submission('y')] }),
      ],
      0.25,
    );

    const lines = summarise(clusters);
    expect(lines[0]).toBe('2 match groups worth reviewing across 1 problem.');
    expect(lines).toContain('1 contains an exact artifact match.');
    // The pair count is kept, but as secondary information.
    expect(lines).toContain('3 similarity relationships are contained in these groups.');
  });

  it('does not count common answers as worth reviewing', () => {
    const clusters = clusterMatches(
      [group({ matchId: 'common', studentCount: 42, identicalStudentCount: 42 })],
      0.25,
    );

    expect(summarise(clusters)[0]).toBe('No matches worth reviewing. 1 common answer set aside.');
    expect(countByType(clusters)).toMatchObject({ all: 1, common: 1, exact: 0 });
  });

  it('says so plainly when there is nothing at all', () => {
    expect(summarise([])).toEqual(['No two students submitted related work.']);
  });
});
