import { describe, it, expect, vi, beforeEach } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  assignment: { findMany: vi.fn() },
  assignmentProblem: { findMany: vi.fn() },
  assignmentProblemGrade: { findMany: vi.fn() },
  submission: { groupBy: vi.fn(), findMany: vi.fn() },
  submissionGrant: { findMany: vi.fn() },
  groupMembership: { findMany: vi.fn() },
}));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

import { getStudentCourseAssignments } from './student-assignments';

/**
 * The content lock has to remove locked content BEFORE serialization, not merely hide it in a
 * component: anything present in the payload is readable in devtools or a raw fetch. These tests
 * therefore assert on the serialized JSON of the whole response, hunting for distinctive secret
 * strings, rather than checking that one field happens to be null.
 */
const ASSIGNMENT_SECRET = 'SECRET-ASSIGNMENT-BODY-9f3a';
const PROBLEM_SECRET = 'SECRET-PROBLEM-BODY-7c1d';

const richDoc = (secret: string) => ({
  version: 1,
  document: {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text: secret }] }],
  },
});

function seed({ unlockAt }: { unlockAt: Date | null }) {
  prismaMock.assignment.findMany.mockResolvedValue([
    {
      id: 'a1',
      title: 'Locked work',
      groupSetId: null,
      description: ASSIGNMENT_SECRET,
      descriptionJson: richDoc(ASSIGNMENT_SECRET),
      unlockAt,
      dueDate: new Date('2999-01-08T00:00:00.000Z'),
      allowLateSubmissions: false,
      lateCutoff: null,
      overrides: [],
    },
  ]);
  prismaMock.assignmentProblem.findMany.mockResolvedValue([
    {
      assignmentId: 'a1',
      maxPoints: 10,
      maxSubmissions: 1,
      autograderEnabled: true,
      problem: {
        id: 'p1',
        title: 'A problem',
        description: PROBLEM_SECRET,
        descriptionJson: richDoc(PROBLEM_SECRET),
        type: 'FA',
        maxStates: null,
        isDeterministic: null,
      },
    },
  ]);
  prismaMock.assignmentProblemGrade.findMany.mockResolvedValue([]);
  prismaMock.submission.groupBy.mockResolvedValue([]);
  prismaMock.submission.findMany.mockResolvedValue([]);
  prismaMock.submissionGrant.findMany.mockResolvedValue([]);
  prismaMock.groupMembership.findMany.mockResolvedValue([]);
}

describe('student assignment content lock', () => {
  beforeEach(() => vi.clearAllMocks());

  it('leaks neither the plain text nor the rich document before unlock', async () => {
    seed({ unlockAt: new Date('2999-01-01T00:00:00.000Z') });

    const result = await getStudentCourseAssignments('stu-1', 'c1');
    const serialized = JSON.stringify(result);

    expect(result[0].locked).toBe(true);
    // The real assertion: neither secret appears anywhere in what the student receives.
    expect(serialized).not.toContain(ASSIGNMENT_SECRET);
    expect(serialized).not.toContain(PROBLEM_SECRET);
    // And specifically, both description forms are gone rather than one of them.
    expect(result[0].description).toBeNull();
    expect(result[0].descriptionJson).toBeNull();
    expect(result[0].problems).toEqual([]);
  });

  it('delivers both forms once the assignment has unlocked', async () => {
    seed({ unlockAt: new Date('2020-01-01T00:00:00.000Z') });

    const result = await getStudentCourseAssignments('stu-1', 'c1');
    const serialized = JSON.stringify(result);

    expect(result[0].locked).toBe(false);
    expect(serialized).toContain(ASSIGNMENT_SECRET);
    expect(serialized).toContain(PROBLEM_SECRET);
    expect(result[0].descriptionJson).toEqual(richDoc(ASSIGNMENT_SECRET));
    expect(result[0].problems[0].descriptionJson).toEqual(richDoc(PROBLEM_SECRET));
  });

  it('delivers both forms when there is no unlock date at all', async () => {
    seed({ unlockAt: null });

    const result = await getStudentCourseAssignments('stu-1', 'c1');

    expect(result[0].locked).toBe(false);
    expect(JSON.stringify(result)).toContain(ASSIGNMENT_SECRET);
  });
});
