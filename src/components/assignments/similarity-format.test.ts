import { describe, expect, it } from 'vitest';
import { byteIdenticalLine, clusterDetails, clusterFacts } from './similarity-format';
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
    expect(lines).not.toContain('Some of them submitted the identical saved artifact.');
  });

  it('keeps the artifact line when the bytes are unknown', () => {
    const lines = clusterDetails(
      cluster({
        type: 'same-machine',
        byteIdenticalStudentCount: 1,
        relationships: [{ identicalStudentCount: 2, kind: 'same-work' }] as MatchCluster['relationships'],
      }),
    );

    expect(lines).toContain('Some of them submitted the identical saved artifact.');
  });
});

describe('clusterFacts', () => {
  it('carries the byte claim too, since a multi-student card shows only the facts', () => {
    expect(clusterFacts(cluster())).toContain('The files are byte-for-byte identical');
  });
});
