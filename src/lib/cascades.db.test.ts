import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/prisma';

/**
 * What survives a delete, against a real Postgres.
 *
 * Every one of these rules is a referential action declared in `schema.prisma` and applied
 * by a migration. Nothing in the unit suite can check them: it mocks Prisma, so a cascade
 * that stopped firing, or a `SetNull` that quietly became a `Cascade`, would look identical
 * to a working one.
 *
 * Two of these carry more weight than the rest. The activity log is an education record
 * under FERPA and the evidence behind a disclosure record, so it has to outlive the account
 * it refers to. And a submission is a student's work; losing one silently is the worst
 * failure this system has. Both are `SetNull` relations, and a `SetNull` is exactly one
 * word away from deleting the thing it was meant to preserve.
 *
 * The fixtures are rebuilt per test because these tests delete their own graph.
 */

const SUFFIX = 'casint';
const ids = {
  student: `u-${SUFFIX}`,
  staff: `s-${SUFFIX}`,
  course: `c-${SUFFIX}`,
  assignment: `a-${SUFFIX}`,
  problem: `p-${SUFFIX}`,
  groupSet: `gs-${SUFFIX}`,
  group: `g-${SUFFIX}`,
};

async function destroyFixtures() {
  await prisma.activityLog.deleteMany({
    where: { OR: [{ userId: { in: [ids.student, ids.staff] } }, { courseId: ids.course }] },
  });
  await prisma.comment.deleteMany({ where: { assignmentId: ids.assignment } });
  await prisma.submissionGrant.deleteMany({ where: { assignmentId: ids.assignment } });
  await prisma.assignmentOverride.deleteMany({ where: { assignmentId: ids.assignment } });
  await prisma.assignmentAssignee.deleteMany({ where: { assignmentId: ids.assignment } });
  await prisma.submission.deleteMany({ where: { courseId: ids.course } });
  await prisma.assignmentProblemGrade.deleteMany({ where: { assignmentId: ids.assignment } });
  await prisma.groupMembership.deleteMany({ where: { courseId: ids.course } });
  await prisma.assignmentProblem.deleteMany({ where: { assignmentId: ids.assignment } });
  await prisma.assignment.deleteMany({ where: { id: ids.assignment } });
  await prisma.problem.deleteMany({ where: { id: ids.problem } });
  await prisma.studentGroup.deleteMany({ where: { groupSetId: ids.groupSet } });
  await prisma.groupSet.deleteMany({ where: { id: ids.groupSet } });
  await prisma.roster.deleteMany({ where: { courseId: ids.course } });
  await prisma.course.deleteMany({ where: { id: ids.course } });
  await prisma.user.deleteMany({ where: { id: { in: [ids.student, ids.staff] } } });
}

/** A course with a student, a group, an assignment, a submission and a log entry. */
async function seedGraph() {
  await prisma.user.createMany({
    data: [
      {
        id: ids.student,
        email: `student-${SUFFIX}@example.test`,
        firstName: 'Cascade',
        lastName: 'Student',
        password: 'not-a-real-hash',
      },
      {
        id: ids.staff,
        email: `staff-${SUFFIX}@example.test`,
        firstName: 'Cascade',
        lastName: 'Staff',
        password: 'not-a-real-hash',
      },
    ],
  });
  await prisma.course.create({
    data: {
      id: ids.course,
      name: 'Cascade Fixture Course',
      code: `KINT ${Math.floor(Math.random() * 900 + 100)}`,
      semester: 'Summer 2026',
      credits: 3,
      timezone: 'America/New_York',
      startDate: new Date('2026-01-01'),
      endDate: new Date('2026-12-31'),
    },
  });
  await prisma.roster.create({
    data: { courseId: ids.course, userId: ids.student, role: 'STUDENT' },
  });
  await prisma.groupSet.create({
    data: { id: ids.groupSet, name: `Set ${SUFFIX}`, courseId: ids.course },
  });
  await prisma.studentGroup.create({
    data: { id: ids.group, name: `Group ${SUFFIX}`, groupSetId: ids.groupSet },
  });
  await prisma.groupMembership.create({
    data: {
      groupSetId: ids.groupSet,
      groupId: ids.group,
      courseId: ids.course,
      userId: ids.student,
    },
  });
  await prisma.problem.create({
    data: { id: ids.problem, title: 'Cascade Problem', type: 'FA', courseId: ids.course },
  });
  await prisma.assignment.create({
    data: {
      id: ids.assignment,
      title: 'Cascade Assignment',
      courseId: ids.course,
      groupSetId: ids.groupSet,
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

const newSubmission = () =>
  prisma.submission.create({
    data: {
      courseId: ids.course,
      assignmentId: ids.assignment,
      problemId: ids.problem,
      studentId: ids.student,
      studentGroupId: ids.group,
      status: 'COMPLETED',
    },
  });

const newLogEntry = (userId: string | null) =>
  prisma.activityLog.create({
    data: {
      userId,
      action: 'GRADE_UPDATED',
      category: 'GRADE',
      severity: 'INFO',
      courseId: ids.course,
      assignmentId: ids.assignment,
    },
  });

beforeEach(async () => {
  await destroyFixtures();
  await seedGraph();
});

afterAll(async () => {
  await destroyFixtures();
  await prisma.$disconnect();
});

describe('the activity log outlives what it refers to', () => {
  it('keeps the entry when the account it names is deleted, and only clears the link', async () => {
    // This is the FERPA case. If the relation were Cascade, deleting a user would erase
    // the record of what they did, including any access to another student's work.
    const entry = await newLogEntry(ids.student);

    await prisma.user.delete({ where: { id: ids.student } });

    const after = await prisma.activityLog.findUnique({ where: { id: entry.id } });
    expect(after).not.toBeNull();
    expect(after?.userId).toBeNull();
    // The description of what happened is untouched; only the link to the person goes.
    expect(after?.action).toBe('GRADE_UPDATED');
    expect(after?.category).toBe('GRADE');
  });

  it('keeps the entry when the course is deleted', async () => {
    const entry = await newLogEntry(ids.student);

    await prisma.course.delete({ where: { id: ids.course } });

    const after = await prisma.activityLog.findUnique({ where: { id: entry.id } });
    expect(after).not.toBeNull();
    expect(after?.courseId).toBeNull();
    expect(after?.assignmentId).toBeNull();
  });

  it('keeps the entry when the submission it refers to is deleted', async () => {
    const submission = await newSubmission();
    const entry = await prisma.activityLog.create({
      data: { userId: ids.student, action: 'SUBMISSION_CREATED', submissionId: submission.id },
    });

    await prisma.submission.delete({ where: { id: submission.id } });

    const after = await prisma.activityLog.findUnique({ where: { id: entry.id } });
    expect(after).not.toBeNull();
    expect(after?.submissionId).toBeNull();
  });
});

describe("a group's removal does not take student work with it", () => {
  it('keeps submissions when the group they were made in is deleted', async () => {
    // Submission.studentGroup is SetNull for exactly this reason. As Cascade, deleting a
    // group would destroy every submission made under it.
    const submission = await newSubmission();

    await prisma.studentGroup.delete({ where: { id: ids.group } });

    const after = await prisma.submission.findUnique({ where: { id: submission.id } });
    expect(after).not.toBeNull();
    expect(after?.studentGroupId).toBeNull();
    expect(after?.studentId).toBe(ids.student);
  });

  it('keeps the assignment when its group set is deleted, and makes it individual', async () => {
    await prisma.groupSet.delete({ where: { id: ids.groupSet } });

    const after = await prisma.assignment.findUnique({ where: { id: ids.assignment } });
    expect(after).not.toBeNull();
    // Group-ness is exactly "has a group set", so clearing it leaves an individual
    // assignment rather than an assignment pointing at a set that is gone.
    expect(after?.groupSetId).toBeNull();
  });

  it('removes the memberships along with the group', async () => {
    // The delete route relies on this: it removes the group and expects membership rows
    // to go with it rather than being left pointing at nothing.
    await prisma.studentGroup.delete({ where: { id: ids.group } });

    const memberships = await prisma.groupMembership.findMany({ where: { courseId: ids.course } });
    expect(memberships).toHaveLength(0);
  });

  it('removes the groups along with their set', async () => {
    await prisma.groupSet.delete({ where: { id: ids.groupSet } });

    const groups = await prisma.studentGroup.findMany({ where: { id: ids.group } });
    expect(groups).toHaveLength(0);
  });
});

describe('leaving a course clears course-scoped membership', () => {
  it('removes group memberships when the roster entry goes', async () => {
    // Otherwise a student removed from the course would still count towards a group, and
    // group submissions resolve through membership.
    await prisma.roster.delete({
      where: { courseId_userId: { courseId: ids.course, userId: ids.student } },
    });

    const memberships = await prisma.groupMembership.findMany({ where: { courseId: ids.course } });
    expect(memberships).toHaveLength(0);
  });

  it('leaves the account itself alone', async () => {
    await prisma.roster.delete({
      where: { courseId_userId: { courseId: ids.course, userId: ids.student } },
    });

    expect(await prisma.user.findUnique({ where: { id: ids.student } })).not.toBeNull();
  });
});

describe('staff provenance survives the staff member', () => {
  it('keeps an override when the person who granted it is deleted', async () => {
    const override = await prisma.assignmentOverride.create({
      data: {
        assignmentId: ids.assignment,
        targetType: 'STUDENT',
        userId: ids.student,
        dueDate: new Date('2026-12-15'),
        createdById: ids.staff,
      },
    });

    await prisma.user.delete({ where: { id: ids.staff } });

    const after = await prisma.assignmentOverride.findUnique({ where: { id: override.id } });
    expect(after).not.toBeNull();
    expect(after?.createdById).toBeNull();
    // The student still has their extension; only the link to the granter goes.
    expect(after?.dueDate).toEqual(new Date('2026-12-15'));
  });

  it('keeps a submission grant when the person who granted it is deleted', async () => {
    // Submission limits are a study variable, so the grant itself has to survive; the
    // durable record of who granted it lives in the activity log.
    const grant = await prisma.submissionGrant.create({
      data: {
        assignmentId: ids.assignment,
        problemId: ids.problem,
        targetType: 'STUDENT',
        userId: ids.student,
        extraSubmissions: 2,
        createdById: ids.staff,
      },
    });

    await prisma.user.delete({ where: { id: ids.staff } });

    const after = await prisma.submissionGrant.findUnique({ where: { id: grant.id } });
    expect(after).not.toBeNull();
    expect(after?.createdById).toBeNull();
    expect(after?.extraSubmissions).toBe(2);
  });

  it('removes a grant that targets a student when that student is deleted', async () => {
    // The other direction is Cascade on purpose: a grant naming nobody is meaningless,
    // and the xor constraint would not allow the userId to simply be nulled.
    const grant = await prisma.submissionGrant.create({
      data: {
        assignmentId: ids.assignment,
        problemId: ids.problem,
        targetType: 'STUDENT',
        userId: ids.student,
        extraSubmissions: 2,
      },
    });

    await prisma.user.delete({ where: { id: ids.student } });

    expect(await prisma.submissionGrant.findUnique({ where: { id: grant.id } })).toBeNull();
  });
});

describe('deleting an account removes that student’s own work', () => {
  it('cascades their submissions', async () => {
    // Worth pinning because it is the asymmetry: the work goes, the audit trail stays.
    // It is also why the app refuses to delete a user who still has submissions rather
    // than relying on this.
    const submission = await newSubmission();

    await prisma.user.delete({ where: { id: ids.student } });

    expect(await prisma.submission.findUnique({ where: { id: submission.id } })).toBeNull();
  });

  it('keeps the log of what they did, so the two do not go together', async () => {
    const submission = await newSubmission();
    const entry = await newLogEntry(ids.student);

    await prisma.user.delete({ where: { id: ids.student } });

    expect(await prisma.submission.findUnique({ where: { id: submission.id } })).toBeNull();
    expect(await prisma.activityLog.findUnique({ where: { id: entry.id } })).not.toBeNull();
  });
});
