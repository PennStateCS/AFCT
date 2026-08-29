import { describe, expect, it } from 'vitest';

import {
  atRisk,
  compareAssignments,
  compareProblemTypes,
  courseAverages,
  problemTypeKey,
  type CourseAssignment,
  type CourseGradeCell,
} from './course-statistics';

const assignment = (over: Partial<CourseAssignment> & { id: string }): CourseAssignment => ({
  title: over.id,
  dueAt: new Date('2026-09-01T00:00:00Z').getTime(),
  maxPoints: 10,
  isPublished: true,
  unit: 'student',
  participantCount: 2,
  ...over,
});

const cell = (
  participantId: string,
  assignmentId: string,
  earned: number | null,
  possible = 10,
): CourseGradeCell => ({ participantId, assignmentId, earned, possible });

describe('courseAverages', () => {
  const week8 = [
    assignment({ id: 'a1' }),
    assignment({ id: 'a2' }),
    // Set but not marked yet, and a draft nobody can see.
    assignment({ id: 'a3' }),
    assignment({ id: 'draft', isPublished: false }),
  ];

  it('reads ungraded work as unearned, the way the gradebook does', () => {
    const [everything] = [
      courseAverages(week8, [cell('s1', 'a1', 10), cell('s1', 'a2', 8), cell('s1', 'a3', null)])
        .everythingAssigned,
    ];

    // 18 of 30: the third assignment is set, and nothing is recorded for it.
    expect(everything.includedCount).toBe(1);
    expect(everything.mean).toBeCloseTo(60, 5);
  });

  it('offers the graded-work-only reading beside it', () => {
    const { gradedOnly } = courseAverages(week8, [
      cell('s1', 'a1', 10),
      cell('s1', 'a2', 8),
      cell('s1', 'a3', null),
    ]);

    // 18 of 20: the same student, measured against the work that has been marked.
    expect(gradedOnly.mean).toBeCloseTo(90, 5);
  });

  it('never counts a draft against anybody', () => {
    // A student cannot do work they cannot see, so an unpublished assignment is out of both
    // denominators. The gradebook counts it, which is a wart there rather than a rule.
    const { everythingAssigned } = courseAverages(week8, [
      cell('s1', 'a1', 10),
      cell('s1', 'a2', 10),
      cell('s1', 'a3', 10),
      cell('s1', 'draft', null),
    ]);

    expect(everythingAssigned.mean).toBe(100);
    expect(everythingAssigned.assignmentsCounted).toBe(3);
  });

  it('says nothing about a student with nothing graded, rather than calling it zero', () => {
    const { everythingAssigned, gradedOnly } = courseAverages(week8, [
      cell('s1', 'a1', null),
      cell('s1', 'a2', null),
    ]);

    expect(everythingAssigned.includedCount).toBe(0);
    expect(gradedOnly.includedCount).toBe(0);
  });

  it('reports how much of the course the number covers', () => {
    const { everythingAssigned } = courseAverages(week8, [
      cell('s1', 'a1', 10),
      cell('s1', 'a2', null),
      cell('s1', 'a3', null),
    ]);

    // The line under the chart is built from these: three assignments set, one marked.
    expect(everythingAssigned.assignmentsCounted).toBe(3);
    expect(everythingAssigned.assignmentsWithGrades).toBe(1);
  });
});

describe('compareAssignments', () => {
  it('reads in the order the class met the work', () => {
    const rows = compareAssignments(
      [
        assignment({ id: 'later', dueAt: new Date('2026-10-01T00:00:00Z').getTime() }),
        assignment({ id: 'earlier', dueAt: new Date('2026-09-01T00:00:00Z').getTime() }),
      ],
      [cell('s1', 'later', 5), cell('s1', 'earlier', 10)],
    );

    expect(rows.map((r) => r.id)).toEqual(['earlier', 'later']);
  });

  it('keeps each assignment in its own unit and reports what it cost', () => {
    const rows = compareAssignments(
      [
        assignment({ id: 'solo' }),
        assignment({ id: 'team', unit: 'group', participantCount: 2, maxPoints: 20 }),
      ],
      [
        cell('s1', 'solo', 5),
        cell('s2', 'solo', 10),
        // Two teams, not the eight students in them.
        cell('g1', 'team', 10, 20),
        cell('g2', 'team', 20, 20),
      ],
    );

    const team = rows.find((r) => r.id === 'team')!;
    expect(team.unit).toBe('group');
    expect(team.gradedCount).toBe(2);
    expect(team.pointsLostMean).toBe(5);
  });

  it('leaves an ungraded assignment on the page with nothing to draw', () => {
    const [row] = compareAssignments([assignment({ id: 'a1' })], [cell('s1', 'a1', null)]);

    expect(row?.boxplot).toBeNull();
    expect(row?.gradedCount).toBe(0);
    expect(row?.pointsLostMean).toBeNull();
  });
});

describe('compareProblemTypes', () => {
  it('groups work by the kind of problem it is', () => {
    const rows = compareProblemTypes([
      { type: 'FA', percent: 100, graded: true },
      { type: 'FA', percent: 80, graded: true },
      { type: 'PDA', percent: 40, graded: true },
      // Set but unmarked: it counts toward how much of the row is graded, not toward the
      // scores, or a hand-marked topic would look easy until somebody marked it.
      { type: 'PDA', percent: 0, graded: false },
    ]);

    const fa = rows.find((r) => r.type === 'FA')!;
    const pda = rows.find((r) => r.type === 'PDA')!;
    expect(fa.boxplot?.median).toBe(90);
    expect(pda.gradedCount).toBe(1);
    expect(pda.totalCount).toBe(2);
  });

  it('gives untyped problems a bucket rather than dropping them', () => {
    const rows = compareProblemTypes([{ type: problemTypeKey(null), percent: 50, graded: true }]);

    expect(rows).toHaveLength(1);
    expect(rows[0]!.type).toBe('untyped');
    expect(rows[0]!.title).toBe('No type set');
  });

  it('leaves out a kind the course never set', () => {
    const rows = compareProblemTypes([{ type: 'RE', percent: 70, graded: true }]);

    expect(rows.map((r) => r.type)).toEqual(['RE']);
  });
});

describe('atRisk', () => {
  it('counts the two different worries apart', () => {
    const assignments = [
      assignment({ id: 'a1' }),
      assignment({ id: 'a2' }),
      assignment({ id: 'a3' }),
    ];
    const cells = [
      // Trying and struggling: everything handed in.
      cell('s1', 'a1', 4),
      cell('s1', 'a2', 4),
      cell('s1', 'a3', 4),
      // Gone quiet: two assignments with nothing recorded at all.
      cell('s2', 'a1', 10),
      cell('s2', 'a2', null),
      cell('s2', 'a3', null),
    ];

    const result = atRisk(
      assignments,
      cells,
      new Map([
        ['s1', 40],
        ['s2', 33],
      ]),
      60,
    );

    expect(result.belowThreshold).toBe(2);
    // Only the student who stopped handing work in, because that is the one somebody can
    // still do something about.
    expect(result.missingTwoOrMore).toBe(1);
  });
});
