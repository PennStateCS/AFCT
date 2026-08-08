import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/prisma';

/**
 * The database-level CHECK constraints, against a real Postgres.
 *
 * These exist only as raw SQL inside migration files. Prisma's schema language has no way
 * to express a CHECK, so `schema.prisma` never mentions them, which means nothing else in
 * the repo can notice if they go missing: a unit test cannot, because it mocks Prisma, and
 * a schema drift check cannot, because the schema never claimed them in the first place.
 * Squash or regenerate the migrations from `schema.prisma` and all five would quietly
 * disappear while every other test stayed green.
 *
 * The routes validate these rules too. That is not a reason to skip them here - it is the
 * reason they matter. The constraint is the backstop for a bug in that validation, and a
 * backstop nobody tests is a backstop nobody knows is gone.
 *
 * Each test writes the malformed row directly, bypassing the app, and asserts Postgres
 * refuses it by name.
 */

const SUFFIX = 'conint';
const ids = {
  user: `u-${SUFFIX}`,
  course: `c-${SUFFIX}`,
  assignment: `a-${SUFFIX}`,
  problem: `p-${SUFFIX}`,
  groupSet: `gs-${SUFFIX}`,
  group: `g-${SUFFIX}`,
};

async function destroyFixtures() {
  await prisma.comment.deleteMany({ where: { assignmentId: ids.assignment } });
  await prisma.submissionGrant.deleteMany({ where: { assignmentId: ids.assignment } });
  await prisma.assignmentOverride.deleteMany({ where: { assignmentId: ids.assignment } });
  await prisma.assignmentAssignee.deleteMany({ where: { assignmentId: ids.assignment } });
  await prisma.assignmentProblem.deleteMany({ where: { assignmentId: ids.assignment } });
  await prisma.assignment.deleteMany({ where: { id: ids.assignment } });
  await prisma.problem.deleteMany({ where: { id: ids.problem } });
  await prisma.studentGroup.deleteMany({ where: { groupSetId: ids.groupSet } });
  await prisma.groupSet.deleteMany({ where: { id: ids.groupSet } });
  await prisma.course.deleteMany({ where: { id: ids.course } });
  await prisma.user.deleteMany({ where: { id: ids.user } });
}

async function seedFixtures() {
  await prisma.user.create({
    data: {
      id: ids.user,
      email: `${SUFFIX}@example.test`,
      firstName: 'Constraint',
      lastName: 'Fixture',
      password: 'not-a-real-hash',
    },
  });
  await prisma.course.create({
    data: {
      id: ids.course,
      name: 'Constraint Fixture Course',
      code: `CINT ${Math.floor(Math.random() * 900 + 100)}`,
      semester: 'Summer 2026',
      credits: 3,
      timezone: 'America/New_York',
      startDate: new Date('2026-01-01'),
      endDate: new Date('2026-12-31'),
    },
  });
  await prisma.groupSet.create({
    data: { id: ids.groupSet, name: `Set ${SUFFIX}`, courseId: ids.course },
  });
  await prisma.studentGroup.create({
    data: { id: ids.group, name: `Group ${SUFFIX}`, groupSetId: ids.groupSet },
  });
  await prisma.problem.create({
    data: { id: ids.problem, title: 'Constraint Problem', type: 'FA', courseId: ids.course },
  });
  await prisma.assignment.create({
    data: {
      id: ids.assignment,
      title: 'Constraint Assignment',
      courseId: ids.course,
      dueDate: new Date('2026-12-01'),
    },
  });
  await prisma.assignmentProblem.create({
    data: {
      assignmentId: ids.assignment,
      problemId: ids.problem,
      maxPoints: 100,
      maxSubmissions: 3,
    },
  });
}

/** Assert a write is refused by a named constraint, not by something incidental. */
async function refusedBy(constraint: string, write: () => Promise<unknown>) {
  await expect(write()).rejects.toThrow(new RegExp(constraint));
}

beforeAll(async () => {
  await destroyFixtures();
  await seedFixtures();
});

afterAll(async () => {
  await destroyFixtures();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await prisma.comment.deleteMany({ where: { assignmentId: ids.assignment } });
  await prisma.submissionGrant.deleteMany({ where: { assignmentId: ids.assignment } });
  await prisma.assignmentOverride.deleteMany({ where: { assignmentId: ids.assignment } });
  await prisma.assignmentAssignee.deleteMany({ where: { assignmentId: ids.assignment } });
});

/**
 * Three tables carry the same rule: a row targets exactly one of a student or a group.
 * Both set is the dangerous shape, because reads that resolve a target check one column
 * first and would silently ignore the other.
 */
describe('a target row names a student xor a group', () => {
  describe('AssignmentAssignee', () => {
    it('accepts a student target', async () => {
      const row = await prisma.assignmentAssignee.create({
        data: { assignmentId: ids.assignment, targetType: 'STUDENT', userId: ids.user },
      });

      expect(row.groupId).toBeNull();
    });

    it('accepts a group target', async () => {
      const row = await prisma.assignmentAssignee.create({
        data: { assignmentId: ids.assignment, targetType: 'GROUP', groupId: ids.group },
      });

      expect(row.userId).toBeNull();
    });

    it('refuses a row naming both', async () => {
      await refusedBy('AssignmentAssignee_target_xor', () =>
        prisma.assignmentAssignee.create({
          data: {
            assignmentId: ids.assignment,
            targetType: 'STUDENT',
            userId: ids.user,
            groupId: ids.group,
          },
        }),
      );
    });

    it('refuses a row naming neither', async () => {
      await refusedBy('AssignmentAssignee_target_xor', () =>
        prisma.assignmentAssignee.create({
          data: { assignmentId: ids.assignment, targetType: 'STUDENT' },
        }),
      );
    });

    it('refuses a target whose type disagrees with the column that is set', async () => {
      // Says GROUP, carries a userId. Nothing would resolve this row correctly.
      await refusedBy('AssignmentAssignee_target_xor', () =>
        prisma.assignmentAssignee.create({
          data: { assignmentId: ids.assignment, targetType: 'GROUP', userId: ids.user },
        }),
      );
    });
  });

  describe('AssignmentOverride', () => {
    it('accepts a student target', async () => {
      const row = await prisma.assignmentOverride.create({
        data: {
          assignmentId: ids.assignment,
          targetType: 'STUDENT',
          userId: ids.user,
          dueDate: new Date('2026-12-15'),
        },
      });

      expect(row.groupId).toBeNull();
    });

    it('refuses a row naming both', async () => {
      await refusedBy('AssignmentOverride_target_xor', () =>
        prisma.assignmentOverride.create({
          data: {
            assignmentId: ids.assignment,
            targetType: 'STUDENT',
            userId: ids.user,
            groupId: ids.group,
            dueDate: new Date('2026-12-15'),
          },
        }),
      );
    });

    it('refuses a row naming neither', async () => {
      await refusedBy('AssignmentOverride_target_xor', () =>
        prisma.assignmentOverride.create({
          data: {
            assignmentId: ids.assignment,
            targetType: 'GROUP',
            dueDate: new Date('2026-12-15'),
          },
        }),
      );
    });
  });

  describe('SubmissionGrant', () => {
    it('accepts a student target', async () => {
      const row = await prisma.submissionGrant.create({
        data: {
          assignmentId: ids.assignment,
          problemId: ids.problem,
          targetType: 'STUDENT',
          userId: ids.user,
          extraSubmissions: 2,
        },
      });

      expect(row.groupId).toBeNull();
    });

    it('refuses a row naming both', async () => {
      // A grant that named both would hand extra attempts to a student and a whole group
      // at once, and submission limits are a study variable.
      await refusedBy('SubmissionGrant_target_xor', () =>
        prisma.submissionGrant.create({
          data: {
            assignmentId: ids.assignment,
            problemId: ids.problem,
            targetType: 'STUDENT',
            userId: ids.user,
            groupId: ids.group,
            extraSubmissions: 2,
          },
        }),
      );
    });

    it('refuses a row naming neither', async () => {
      await refusedBy('SubmissionGrant_target_xor', () =>
        prisma.submissionGrant.create({
          data: {
            assignmentId: ids.assignment,
            problemId: ids.problem,
            targetType: 'STUDENT',
            extraSubmissions: 2,
          },
        }),
      );
    });
  });
});

/**
 * An override that changes nothing is not a harmless no-op: it reads as "this student has
 * an exception" everywhere the UI counts overrides, while resolving to the assignment's own
 * dates. The constraint is what keeps that row from existing.
 */
describe('an override must actually change something', () => {
  it.each([
    ['unlockAt', { unlockAt: new Date('2026-11-01') }],
    ['dueDate', { dueDate: new Date('2026-12-15') }],
    ['lateCutoff', { lateCutoff: new Date('2026-12-20') }],
    ['allowLateSubmissions', { allowLateSubmissions: true }],
  ])('accepts an override that sets only %s', async (_label, field) => {
    const row = await prisma.assignmentOverride.create({
      data: {
        assignmentId: ids.assignment,
        targetType: 'STUDENT',
        userId: ids.user,
        ...field,
      },
    });

    expect(row.id).toBeTruthy();
  });

  it('accepts allowLateSubmissions set to false, which is a real change', async () => {
    // `false` is a value, not an absence. A constraint written with a truthiness test
    // rather than a null test would wrongly reject this.
    const row = await prisma.assignmentOverride.create({
      data: {
        assignmentId: ids.assignment,
        targetType: 'STUDENT',
        userId: ids.user,
        allowLateSubmissions: false,
      },
    });

    expect(row.allowLateSubmissions).toBe(false);
  });

  it('refuses an override with every field left empty', async () => {
    await refusedBy('AssignmentOverride_has_change', () =>
      prisma.assignmentOverride.create({
        data: { assignmentId: ids.assignment, targetType: 'STUDENT', userId: ids.user },
      }),
    );
  });

  it('refuses an update that empties the last remaining field', async () => {
    // The constraint has to hold on the way out as well as on the way in, or an edit
    // could strand a row in the shape the insert refused.
    const row = await prisma.assignmentOverride.create({
      data: {
        assignmentId: ids.assignment,
        targetType: 'STUDENT',
        userId: ids.user,
        dueDate: new Date('2026-12-15'),
      },
    });

    await refusedBy('AssignmentOverride_has_change', () =>
      prisma.assignmentOverride.update({ where: { id: row.id }, data: { dueDate: null } }),
    );
  });
});

/**
 * Grants are additive. Zero would be a row that grants nothing, and a negative would
 * silently take attempts away from a student, which no part of the app intends.
 */
describe('a submission grant is for a positive number of attempts', () => {
  const grant = (extraSubmissions: number) => () =>
    prisma.submissionGrant.create({
      data: {
        assignmentId: ids.assignment,
        problemId: ids.problem,
        targetType: 'STUDENT',
        userId: ids.user,
        extraSubmissions,
      },
    });

  it('accepts a single extra attempt', async () => {
    const row = await grant(1)();

    expect(row.extraSubmissions).toBe(1);
  });

  it('refuses zero', async () => {
    await refusedBy('SubmissionGrant_positive', grant(0));
  });

  it('refuses a negative grant, which would remove attempts', async () => {
    await refusedBy('SubmissionGrant_positive', grant(-1));
  });

  it('refuses an update that drives the count to zero', async () => {
    const row = await grant(2)();

    await refusedBy('SubmissionGrant_positive', () =>
      prisma.submissionGrant.update({ where: { id: row.id }, data: { extraSubmissions: 0 } }),
    );
  });
});

/**
 * A comment is addressed to one student OR one group. Unlike the three tables above it may
 * also be addressed to neither (a comment on the problem itself, with no subject), so the
 * rule here is "not both" rather than a strict xor.
 */
describe('Comment names at most one subject', () => {
  const base = {
    content: 'Fixture comment',
    assignmentId: ids.assignment,
    problemId: ids.problem,
    authorId: ids.user,
  };

  it('accepts a comment about a student', async () => {
    const row = await prisma.comment.create({
      data: { ...base, aboutStudentId: ids.user },
    });
    expect(row.aboutGroupId).toBeNull();
  });

  it('accepts a comment about a group', async () => {
    const row = await prisma.comment.create({
      data: { ...base, aboutGroupId: ids.group },
    });
    expect(row.aboutStudentId).toBeNull();
  });

  it('accepts a comment about neither', async () => {
    const row = await prisma.comment.create({ data: base });
    expect(row.aboutStudentId).toBeNull();
    expect(row.aboutGroupId).toBeNull();
  });

  // Both set has no coherent audience, and the read path ORs the two columns, so such a row
  // would come back twice for a member of that group.
  it('refuses a comment naming both a student and a group', async () => {
    await refusedBy('Comment_target_not_both', () =>
      prisma.comment.create({
        data: { ...base, aboutStudentId: ids.user, aboutGroupId: ids.group },
      }),
    );
  });
});

/**
 * Deleting a group must not take the feedback with it. The FK is SET NULL rather than the
 * CASCADE used for aboutStudent, so the comment survives and simply stops being addressed.
 */
describe('deleting a group keeps its comments', () => {
  it('nulls aboutGroupId instead of deleting the row', async () => {
    const doomed = await prisma.studentGroup.create({
      data: { name: `Doomed ${SUFFIX}`, groupSetId: ids.groupSet },
    });
    const comment = await prisma.comment.create({
      data: {
        content: 'Feedback that must outlive the group',
        assignmentId: ids.assignment,
        problemId: ids.problem,
        authorId: ids.user,
        aboutGroupId: doomed.id,
      },
    });

    await prisma.studentGroup.delete({ where: { id: doomed.id } });

    const after = await prisma.comment.findUnique({ where: { id: comment.id } });
    expect(after).not.toBeNull();
    expect(after?.aboutGroupId).toBeNull();
    expect(after?.content).toBe('Feedback that must outlive the group');
  });
});
