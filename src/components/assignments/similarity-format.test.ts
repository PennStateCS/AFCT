import { describe, expect, it } from 'vitest';
import {
  byteIdenticalLine,
  clusterDetails,
  clusterFacts,
  clusterHeadline,
} from './similarity-format';
import type { MatchCluster, MatchType } from '@/lib/similarity/evidence';

const student = (id: string) => ({
  id: `sub-${id}`,
  submittedAt: '2026-08-15T12:00:00.000Z',
  correct: true,
  attempt: 1,
  assignmentId: 'a1',
  fileName: `${id}.jff`,
  originalFileName: `${id}.jff`,
  contentKey: 'aaaa1111',
  student: {
    id,
    firstName: id,
    lastName: 'Student',
    avatar: null,
    cropX: null,
    cropY: null,
    zoom: null,
  },
  studentGroup: null,
});

const cluster = (over: Partial<MatchCluster> = {}): MatchCluster =>
  ({
    id: 'p1:s1',
    problem: { id: 'p1', title: 'Ends in 01', type: 'FA' },
    relationships: [],
    students: [student('s1'), student('s2')],
    type: 'exact' as MatchType,
    strength: 'very-strong',
    counts: { exact: 1, 'same-machine': 0, structural: 0 },
    byteIdenticalStudentCount: 2,
    problemStudentCount: 40,
    reusedAfterPass: false,
    matchesAnswerFile: false,
    answerFileRelationships: 0,
    closestGapMs: null,
    earliest: null,
    stateCount: 9,
    transitionCount: 17,
    ...over,
  }) as MatchCluster;

describe('byteIdenticalLine', () => {
  it('says it plainly when every file in the group is the same bytes', () => {
    expect(byteIdenticalLine(cluster())).toBe('The files are byte-for-byte identical.');
  });

  it('counts them when only some of the group are', () => {
    expect(
      byteIdenticalLine(
        cluster({ students: [student('s1'), student('s2'), student('s3')] }),
      ),
    ).toBe('2 of them submitted byte-for-byte identical files.');
  });

  it('says nothing when no two files match, or when none were hashed', () => {
    expect(byteIdenticalLine(cluster({ byteIdenticalStudentCount: 1 }))).toBeNull();
  });

  it('never says it of a common answer', () => {
    // Half a class submitting the identical grammar is what the right answer looks like, and
    // the strongest wording on a card the page has set aside would read as an accusation.
    expect(byteIdenticalLine(cluster({ type: 'common' }))).toBeNull();
  });
});

describe('clusterDetails', () => {
  it('leads an exact match with the bytes, then the weaker version of the same claim', () => {
    expect(clusterDetails(cluster())[0]).toBe('The files are byte-for-byte identical.');
  });

  it('leaves the exact match as it was when nothing was hashed', () => {
    expect(clusterDetails(cluster({ byteIdenticalStudentCount: 1 }))[0]).toBe(
      'The structure and the saved drawing coordinates are identical.',
    );
  });

  it('replaces the artifact line on a same-machine match rather than doubling it', () => {
    const lines = clusterDetails(
      cluster({
        type: 'same-machine',
        students: [student('s1'), student('s2'), student('s3')],
        relationships: [{ identicalStudentCount: 2, kind: 'same-work' }] as MatchCluster['relationships'],
      }),
    );

    expect(lines).toContain('2 of them submitted byte-for-byte identical files.');
    expect(lines).not.toContain('Some of them submitted the same file, once formatting is set aside.');
  });

  it('keeps the artifact line when the bytes are unknown', () => {
    const lines = clusterDetails(
      cluster({
        type: 'same-machine',
        byteIdenticalStudentCount: 1,
        relationships: [{ identicalStudentCount: 2, kind: 'same-work' }] as MatchCluster['relationships'],
      }),
    );

    expect(lines).toContain('Some of them submitted the same file, once formatting is set aside.');
  });
});

describe('clusterHeadline', () => {
  const relationship = (over: Record<string, unknown> = {}) =>
    ({
      matchId: 'r',
      kind: 'same-work',
      evidence: [],
      stateCount: 9,
      transitionCount: 17,
      problem: { id: 'p1', title: 'Ends in 01', type: 'FA' },
      studentCount: 2,
      problemStudentCount: 40,
      identicalStudentCount: 2,
      byteIdenticalStudentCount: 1,
      closestGapMs: null,
      reusedAfterPass: false,
      matchesAnswerFile: false,
      submissions: [],
      ...over,
    }) as unknown as MatchCluster['relationships'][number];

  it('says what everyone did when one relationship covers the whole group', () => {
    expect(
      clusterHeadline(cluster({ relationships: [relationship()] })),
    ).toBe('2 of 40 students submitted the same saved machine');
  });

  it('goes neutral once a group holds more than one relationship', () => {
    // Alice and Bob sent the same file; Bob and Carol only share structure. Carol did not
    // submit Alice's machine, so the group cannot say all three did.
    const mixed = cluster({
      type: 'exact',
      students: [student('a'), student('b'), student('c')],
      relationships: [relationship({ matchId: 'ab' }), relationship({ matchId: 'bc', kind: 'near' })],
    });

    expect(clusterHeadline(mixed)).toBe('3 of 40 students are connected by 2 similarity relationships');
    expect(clusterDetails(mixed)).not.toContain('The structure and the saved drawing coordinates are identical.');
  });

  it('goes neutral for a same-machine group with a structural relationship too', () => {
    const mixed = cluster({
      type: 'same-machine',
      students: [student('a'), student('b'), student('c')],
      relationships: [relationship({ matchId: 'ab' }), relationship({ matchId: 'bc', kind: 'near' })],
    });

    expect(clusterHeadline(mixed)).toBe('3 of 40 students are connected by 2 similarity relationships');
  });

  it('never spreads byte-for-byte wording across students who do not share those bytes', () => {
    // Two of the three submitted identical bytes; the third is only connected to them.
    const mixed = cluster({
      type: 'exact',
      students: [student('a'), student('b'), student('c')],
      byteIdenticalStudentCount: 2,
      relationships: [relationship({ matchId: 'ab' }), relationship({ matchId: 'bc', kind: 'near' })],
    });

    expect(byteIdenticalLine(mixed)).toBe('2 of them submitted byte-for-byte identical files.');
    expect(clusterFacts(mixed)).not.toContain('The files are byte-for-byte identical');
  });
});

describe('the instructor reference solution', () => {
  it('explains the match instead of grading the evidence', () => {
    const posted = cluster({ type: 'reference', matchesAnswerFile: true, answerFileRelationships: 1 });

    expect(clusterHeadline(posted)).toBe('2 of 40 students submitted the machine the instructor posted');
    expect(clusterDetails(posted)).toContain(
      'This work is the solution the instructor posted for this problem.',
    );
    // Nothing about how alike the artifacts are, and no byte claim: everybody holding the
    // posted file has it to the byte.
    expect(clusterDetails(posted)).not.toContain('The structure and the saved drawing coordinates are identical.');
    expect(byteIdenticalLine(posted)).toBeNull();
  });

  it('names the pair when only part of a group is the posted solution', () => {
    const partly = cluster({ matchesAnswerFile: false, answerFileRelationships: 1 });

    expect(clusterDetails(partly)).toContain(
      '1 relationship in this group is the instructor reference solution.',
    );
    expect(clusterDetails(partly)).not.toContain('Matches the instructor reference solution.');
  });

  it('says nothing about the posted solution on a common answer that is not it', () => {
    const common = cluster({ type: 'common', matchesAnswerFile: false, answerFileRelationships: 0 });
    expect(clusterDetails(common)).toEqual(['Submitted by enough of the class to be the expected answer.']);
  });
});

describe('clusterFacts', () => {
  it('carries the byte claim too, since a multi-student card shows only the facts', () => {
    expect(clusterFacts(cluster())).toContain('The files are byte-for-byte identical');
  });
});
