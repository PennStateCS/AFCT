import { describe, expect, it } from 'vitest';
import {
  byteIdenticalLine,
  clusterDetails,
  clusterFacts,
  clusterHeadline,
  relationshipByteLines,
  relationshipDetails,
  relationshipParticipants,
} from './similarity-format';
import type { MatchCluster, MatchType } from '@/lib/similarity/evidence';

const student = (
  id: string,
  over: {
    attempt?: number;
    byteKey?: string | null;
    group?: { id: string; name: string } | null;
    at?: string;
  } = {},
) => ({
  id: `sub-${id}-${over.attempt ?? 1}`,
  submittedAt: over.at ?? '2026-08-15T12:00:00.000Z',
  correct: true,
  attempt: over.attempt ?? 1,
  assignmentId: 'a1',
  fileName: `${id}.jff`,
  originalFileName: `${id}.jff`,
  contentKey: 'aaaa1111',
  // Which set of byte-identical files this submission is in. Same label, same bytes.
  byteKey: over.byteKey === undefined ? 'b1' : over.byteKey,
  student: {
    id,
    firstName: id,
    lastName: 'Student',
    avatar: null,
    cropX: null,
    cropY: null,
    zoom: null,
  },
  studentGroup: over.group ?? null,
});

/** One relationship: the submissions in it, and what the detector said about them. */
const relationship = (over: Record<string, unknown> = {}) =>
  ({
    matchId: 'r1',
    kind: 'same-work',
    evidence: [],
    stateCount: 9,
    transitionCount: 17,
    problem: { id: 'p1', title: 'Ends in 01', type: 'FA' },
    studentCount: 2,
    problemStudentCount: 40,
    groupCount: 0,
    problemGroupCount: 0,
    identicalStudentCount: 2,
    byteIdenticalStudentCount: 2,
    closestGapMs: null,
    reusedAfterPass: false,
    matchesAnswerFile: false,
    submissions: [student('s1'), student('s2')],
    ...over,
  }) as unknown as MatchCluster['relationships'][number];

const cluster = (over: Partial<MatchCluster> = {}): MatchCluster =>
  ({
    id: 'p1:s1',
    problem: { id: 'p1', title: 'Ends in 01', type: 'FA' },
    relationships: [relationship()],
    students: [student('s1'), student('s2')],
    groups: [],
    attempts: [student('s1'), student('s2')],
    problemGroupCount: 0,
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

describe('byte-for-byte equality, said where it is true', () => {
  it('says it plainly when the whole match is one set of files', () => {
    expect(byteIdenticalLine(cluster())).toBe('The files are byte-for-byte identical.');
    expect(relationshipByteLines(relationship())).toEqual(['Files are byte-for-byte identical.']);
  });

  it('names the participants when only some of a relationship agree', () => {
    // Three students hold the same work; two of them hold the same file. Saying "2 of them"
    // would leave a reader to work out which two, which is the thing this page must not do.
    const partly = relationship({
      studentCount: 3,
      submissions: [
        student('Miles', { byteKey: 'b1' }),
        student('Sam', { byteKey: 'b1' }),
        student('Stephen', { byteKey: 'b2' }),
      ],
    });

    expect(relationshipByteLines(partly)).toEqual([
      'Miles Student and Sam Student submitted byte-for-byte identical files.',
    ]);
  });

  it('counts the files when every one of three or more agrees', () => {
    const three = relationship({
      studentCount: 3,
      submissions: [student('a'), student('b'), student('c')],
    });

    expect(relationshipByteLines(three)).toEqual([
      'All 3 submitted files are byte-for-byte identical.',
    ]);
  });

  it('reports two separate sets of identical files, and who is in each', () => {
    const twoSets = relationship({
      studentCount: 4,
      submissions: [
        student('a', { byteKey: 'b1' }),
        student('b', { byteKey: 'b1' }),
        student('c', { byteKey: 'b2' }),
        student('d', { byteKey: 'b2' }),
      ],
    });

    expect(relationshipByteLines(twoSets)).toEqual([
      '2 sets of byte-for-byte identical files were found.',
      'a Student and b Student submitted byte-for-byte identical files.',
      'c Student and d Student submitted byte-for-byte identical files.',
    ]);
  });

  it('names the teams, not their members, on a group assignment', () => {
    const teams = relationship({
      submissions: [
        student('alice', { group: { id: 'g4', name: 'Group 4' } }),
        student('david', { group: { id: 'g7', name: 'Group 7' } }),
        student('bob', { group: { id: 'g4', name: 'Group 4' }, attempt: 2 }),
      ],
    });

    expect(relationshipByteLines(teams, 'group')).toEqual([
      'All 3 submitted files are byte-for-byte identical.',
    ]);
  });

  it('says nothing about files nobody hashed, and nothing about a set-aside group', () => {
    const unhashed = relationship({
      submissions: [student('a', { byteKey: null }), student('b', { byteKey: null })],
    });

    expect(relationshipByteLines(unhashed)).toEqual([]);
    expect(
      byteIdenticalLine(
        cluster({ attempts: [student('a', { byteKey: null }), student('b', { byteKey: null })] }),
      ),
    ).toBeNull();
    expect(byteIdenticalLine(cluster({ type: 'common' }))).toBeNull();
  });

  it('makes no claim at cluster level when only part of the cluster agrees', () => {
    // Four students on one card through a shared student. Three of them sent the same file;
    // the fourth did not. "3 of them are byte-for-byte identical" names nobody, so the
    // cluster says nothing and the relationship underneath says who.
    const mixed = cluster({
      students: [student('a'), student('b'), student('c'), student('d')],
      attempts: [
        student('a', { byteKey: 'b1' }),
        student('b', { byteKey: 'b1' }),
        student('c', { byteKey: 'b1' }),
        student('d', { byteKey: 'b2' }),
      ],
      byteIdenticalStudentCount: 3,
      relationships: [relationship({ matchId: 'r1' }), relationship({ matchId: 'r2' })],
    });

    expect(byteIdenticalLine(mixed)).toBeNull();
    expect(clusterDetails(mixed)).not.toContain(
      '3 of them submitted byte-for-byte identical files.',
    );
  });
});

describe('relationshipParticipants', () => {
  it('pairs each participant with their own attempts', () => {
    // Stephen's second attempt is in this relationship; the others' first. "Attempts 1 and 2"
    // would leave whose unanswered.
    const relation = relationship({
      submissions: [
        student('Stephen', { attempt: 2, at: '2026-08-15T13:00:00.000Z' }),
        student('Miles', { attempt: 1, at: '2026-08-15T12:00:00.000Z' }),
        student('Sam', { attempt: 1, at: '2026-08-15T11:00:00.000Z' }),
      ],
    });

    expect(
      relationshipParticipants(relation).map((p) => [p.name, p.attempts.map((a) => a.attempt)]),
    ).toEqual([
      ['Sam Student', [1]],
      ['Miles Student', [1]],
      ['Stephen Student', [2]],
    ]);
  });

  it("keeps both of one participant's attempts when both are in the relationship", () => {
    const relation = relationship({
      submissions: [
        student('Stephen', { attempt: 1, at: '2026-08-15T11:00:00.000Z' }),
        student('Stephen', { attempt: 2, at: '2026-08-15T12:00:00.000Z' }),
        student('Thor', { attempt: 1, at: '2026-08-15T13:00:00.000Z' }),
      ],
    });

    const participants = relationshipParticipants(relation);
    expect(participants).toHaveLength(2);
    expect(participants[0]?.attempts.map((a) => a.attempt)).toEqual([1, 2]);
  });

  it('makes the team the participant and keeps the submitter on the attempt', () => {
    const relation = relationship({
      submissions: [
        student('alice', { group: { id: 'g4', name: 'Group 4' }, attempt: 2 }),
        student('david', { group: { id: 'g7', name: 'Group 7' }, attempt: 1 }),
      ],
    });

    const participants = relationshipParticipants(relation, 'group');
    expect(participants.map((p) => p.name)).toEqual(['Group 4', 'Group 7']);
    expect(participants[0]?.attempts[0]?.student.firstName).toBe('alice');
  });
});

describe('relationshipDetails', () => {
  it("carries the relationship's own evidence, strongest first", () => {
    expect(relationshipDetails(relationship())).toEqual([
      'Files are byte-for-byte identical.',
      'Contents are identical once formatting is set aside.',
    ]);
  });

  it('says the machine is the same when the files are not', () => {
    const redrawn = relationship({
      identicalStudentCount: 1,
      submissions: [student('a', { byteKey: 'b1' }), student('b', { byteKey: 'b2' })],
    });

    expect(relationshipDetails(redrawn)).toEqual([
      'The same machine, with state names or positions differing.',
    ]);
  });

  it("uses the third check's own findings for a structural relationship", () => {
    const near = relationship({
      kind: 'near',
      evidence: ['They differ by 1 transition'],
      submissions: [student('a', { byteKey: null }), student('b', { byteKey: null })],
    });

    expect(relationshipDetails(near)).toEqual(['They differ by 1 transition']);
  });
});

describe('clusterDetails', () => {
  it('leads an exact match with the bytes, then the weaker version of the same claim', () => {
    // A cluster of one relationship speaks in that relationship's words.
    expect(clusterDetails(cluster())[0]).toBe('Files are byte-for-byte identical.');
  });

  it('leaves the exact match as it was when nothing was hashed', () => {
    const unhashed = cluster({
      attempts: [student('a', { byteKey: null }), student('b', { byteKey: null })],
      relationships: [
        relationship({
          submissions: [student('a', { byteKey: null }), student('b', { byteKey: null })],
        }),
      ],
    });

    expect(clusterDetails(unhashed)[0]).toBe(
      'The structure and the saved drawing coordinates are identical.',
    );
  });

  it('says the closest submissions were RELATED ones', () => {
    expect(clusterDetails(cluster({ closestGapMs: 11 * 60 * 1000 }))).toContain(
      'Closest related submissions were 11 minutes apart.',
    );
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
    expect(clusterHeadline(cluster({ relationships: [relationship()] }))).toBe(
      '2 of 40 students submitted the same saved machine',
    );
  });

  it('goes neutral once a group holds more than one relationship', () => {
    // Alice and Bob sent the same file; Bob and Carol only share structure. Carol did not
    // submit Alice's machine, so the group cannot say all three did.
    const mixed = cluster({
      type: 'exact',
      students: [student('a'), student('b'), student('c')],
      relationships: [
        relationship({ matchId: 'ab' }),
        relationship({ matchId: 'bc', kind: 'near' }),
      ],
    });

    expect(clusterHeadline(mixed)).toBe(
      '3 of 40 students are connected by 2 similarity relationships',
    );
    expect(clusterDetails(mixed)).not.toContain(
      'The structure and the saved drawing coordinates are identical.',
    );
  });

  it('goes neutral for a same-machine group with a structural relationship too', () => {
    const mixed = cluster({
      type: 'same-machine',
      students: [student('a'), student('b'), student('c')],
      relationships: [
        relationship({ matchId: 'ab' }),
        relationship({ matchId: 'bc', kind: 'near' }),
      ],
    });

    expect(clusterHeadline(mixed)).toBe(
      '3 of 40 students are connected by 2 similarity relationships',
    );
  });

  it('never spreads byte-for-byte wording across students who do not share those bytes', () => {
    // Two of the three submitted identical bytes; the third is only connected to them, so
    // the cluster says nothing about raw files and the relationship names the two that do.
    const shared = relationship({
      matchId: 'ab',
      submissions: [student('a', { byteKey: 'b1' }), student('b', { byteKey: 'b1' })],
    });
    const mixed = cluster({
      type: 'exact',
      students: [student('a'), student('b'), student('c')],
      attempts: [
        student('a', { byteKey: 'b1' }),
        student('b', { byteKey: 'b1' }),
        student('c', { byteKey: 'b2' }),
      ],
      byteIdenticalStudentCount: 2,
      relationships: [shared, relationship({ matchId: 'bc', kind: 'near' })],
    });

    expect(byteIdenticalLine(mixed)).toBeNull();
    expect(clusterFacts(mixed)).not.toContain('The files are byte-for-byte identical');
    expect(relationshipByteLines(shared)).toEqual(['Files are byte-for-byte identical.']);
  });
});

describe('the instructor reference solution', () => {
  it('explains the match instead of grading the evidence', () => {
    const posted = cluster({
      type: 'reference',
      matchesAnswerFile: true,
      answerFileRelationships: 1,
    });

    expect(clusterHeadline(posted)).toBe(
      '2 of 40 students submitted the machine the instructor posted',
    );
    expect(clusterDetails(posted)).toContain(
      'This work is the solution the instructor posted for this problem.',
    );
    // Nothing about how alike the artifacts are, and no byte claim: everybody holding the
    // posted file has it to the byte.
    expect(clusterDetails(posted)).not.toContain(
      'The structure and the saved drawing coordinates are identical.',
    );
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
    const common = cluster({
      type: 'common',
      matchesAnswerFile: false,
      answerFileRelationships: 0,
    });
    expect(clusterDetails(common)).toEqual([
      'Submitted by enough of the class to be the expected answer.',
    ]);
  });
});

describe('clusterFacts', () => {
  it('carries the byte claim too, since a multi-student card shows only the facts', () => {
    expect(clusterFacts(cluster())).toContain('The files are byte-for-byte identical');
  });
});
