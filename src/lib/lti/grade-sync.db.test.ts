import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/prisma';
import { queueChangedGrades, assignmentSyncState, courseIsLinked } from './grade-sync';

/**
 * Working out which grades still need to reach the LMS, against a real Postgres.
 *
 * Derived by comparison rather than by hooking every place a grade is written, so the case that
 * matters is that a changed grade is picked up and an unchanged one is not queued again.
 */

const ISSUER = 'https://canvas.example.test';
const PLATFORM = 'ltip-sync';
const COURSE = 'c-sync';
const UNLINKED_COURSE = 'c-sync-unlinked';
const ASSIGNMENT = 'a-sync';
const PROBLEM = 'p-sync';
const STUDENT = 'u-sync';

async function destroyFixtures() {
  await prisma.ltiScoreQueue.deleteMany({});
  await prisma.assignmentProblemGrade.deleteMany({ where: { assignmentId: ASSIGNMENT } });
  await prisma.assignmentProblem.deleteMany({ where: { assignmentId: ASSIGNMENT } });
  await prisma.ltiContextLink.deleteMany({ where: { platformId: PLATFORM } });
  await prisma.assignment.deleteMany({ where: { id: ASSIGNMENT } });
  await prisma.problem.deleteMany({ where: { id: PROBLEM } });
  await prisma.ltiPlatform.deleteMany({ where: { id: PLATFORM } });
  await prisma.course.deleteMany({ where: { id: { in: [COURSE, UNLINKED_COURSE] } } });
  await prisma.user.deleteMany({ where: { id: STUDENT } });
}

const courseFields = {
  code: 'CMPSC 464',
  semester: 'Fall 2026',
  credits: 3,
  startDate: new Date('2026-08-24T00:00:00Z'),
  endDate: new Date('2026-12-18T00:00:00Z'),
};

beforeEach(async () => {
  await destroyFixtures();
  await prisma.user.create({ data: { id: STUDENT, email: 'sync@example.test', password: null } });
  await prisma.course.createMany({
    data: [
      { id: COURSE, name: 'Theory', ...courseFields },
      { id: UNLINKED_COURSE, name: 'Not linked', ...courseFields },
    ],
  });
  await prisma.assignment.create({
    data: { id: ASSIGNMENT, courseId: COURSE, title: 'Problem set 1', dueDate: new Date() },
  });
  await prisma.problem.create({
    data: { id: PROBLEM, courseId: COURSE, title: 'Q1', type: 'FA' },
  });
  await prisma.assignmentProblem.create({
    data: { assignmentId: ASSIGNMENT, problemId: PROBLEM, maxPoints: 100 },
  });
  await prisma.ltiPlatform.create({
    data: {
      id: PLATFORM,
      name: 'Canvas',
      issuer: ISSUER,
      clientId: 'client-1',
      deploymentId: '1',
      authLoginUrl: `${ISSUER}/auth`,
      tokenUrl: `${ISSUER}/token`,
      keysetUrl: `${ISSUER}/jwks`,
    },
  });
  await prisma.ltiContextLink.create({
    data: { platformId: PLATFORM, contextId: 'ctx-1', courseId: COURSE },
  });
});

afterAll(async () => {
  await destroyFixtures();
  await prisma.$disconnect();
});

const grade = (value: number) =>
  prisma.assignmentProblemGrade.upsert({
    where: {
      assignmentId_problemId_studentId: {
        assignmentId: ASSIGNMENT,
        problemId: PROBLEM,
        studentId: STUDENT,
      },
    },
    create: { studentId: STUDENT, assignmentId: ASSIGNMENT, problemId: PROBLEM, grade: value },
    update: { grade: value },
  });

describe('queueing what has changed', () => {
  it('queues a grade that has never been sent', async () => {
    await grade(88);

    expect(await queueChangedGrades(ASSIGNMENT)).toBe(1);
    expect(await prisma.ltiScoreQueue.findFirstOrThrow()).toMatchObject({
      scoreGiven: 88,
      scoreMaximum: 100,
    });
  });

  // Otherwise every pass would re-send every grade in the course.
  it('leaves an unchanged grade alone', async () => {
    await grade(88);
    await queueChangedGrades(ASSIGNMENT);

    expect(await queueChangedGrades(ASSIGNMENT)).toBe(0);
  });

  it('queues again once the grade changes', async () => {
    await grade(88);
    await queueChangedGrades(ASSIGNMENT);
    await grade(95);

    expect(await queueChangedGrades(ASSIGNMENT)).toBe(1);
    expect((await prisma.ltiScoreQueue.findFirstOrThrow()).scoreGiven).toBe(95);
  });

  /**
   * A grade changed while the LMS was down is picked up on a later pass, which is the reason
   * for comparing rather than hooking the write.
   */
  it('picks up a grade that changed after a delivery', async () => {
    await grade(88);
    await queueChangedGrades(ASSIGNMENT);
    await prisma.ltiScoreQueue.updateMany({ data: { state: 'SENT', sentAt: new Date() } });

    await grade(70);

    expect(await queueChangedGrades(ASSIGNMENT)).toBe(1);
    expect(await prisma.ltiScoreQueue.findFirstOrThrow()).toMatchObject({
      scoreGiven: 70,
      state: 'PENDING',
    });
  });

  /**
   * The loop this prevents: a failed grade re-queued every pass, retried against a cause only
   * a person can fix, littering the LMS with a duplicate column each time. Seen for real.
   */
  it('leaves a failed grade alone rather than retrying for ever', async () => {
    await grade(88);
    await queueChangedGrades(ASSIGNMENT);
    await prisma.ltiScoreQueue.updateMany({ data: { state: 'FAILED', lastError: 'refused' } });

    expect(await queueChangedGrades(ASSIGNMENT)).toBe(0);
    expect((await prisma.ltiScoreQueue.findFirstOrThrow()).state).toBe('FAILED');
  });

  // "Send grades now" is the one place a failed grade is tried again.
  it('retries a failed grade when asked deliberately', async () => {
    await grade(88);
    await queueChangedGrades(ASSIGNMENT);
    await prisma.ltiScoreQueue.updateMany({ data: { state: 'FAILED', lastError: 'refused' } });

    expect(await queueChangedGrades(ASSIGNMENT, { retryFailed: true })).toBe(1);
    expect((await prisma.ltiScoreQueue.findFirstOrThrow()).state).toBe('PENDING');
  });

  /**
   * Extra credit can push a total past the maximum and a correction can leave it negative.
   * Platforms reject the whole request for either, which would strand every grade in the batch
   * rather than the one odd score.
   */
  it('holds a score to the range the LMS will accept', async () => {
    await grade(130);
    await queueChangedGrades(ASSIGNMENT);
    expect((await prisma.ltiScoreQueue.findFirstOrThrow()).scoreGiven).toBe(100);

    await grade(-5);
    await queueChangedGrades(ASSIGNMENT);
    expect((await prisma.ltiScoreQueue.findFirstOrThrow()).scoreGiven).toBe(0);
  });

  it('does nothing for a course with no LMS', async () => {
    await grade(88);
    await prisma.ltiContextLink.deleteMany({});

    expect(await queueChangedGrades(ASSIGNMENT)).toBe(0);
    expect(await prisma.ltiScoreQueue.count()).toBe(0);
  });

  // A percentage out of nothing is meaningless, and the LMS refuses it.
  it('does nothing when the assignment is worth no points', async () => {
    await grade(0);
    await prisma.assignmentProblem.updateMany({
      where: { assignmentId: ASSIGNMENT },
      data: { maxPoints: 0 },
    });

    expect(await queueChangedGrades(ASSIGNMENT)).toBe(0);
  });

  it('ignores students with no grade at all', async () => {
    expect(await queueChangedGrades(ASSIGNMENT)).toBe(0);
  });
});

describe('what faculty are shown', () => {
  it('reports the course as linked, with the counts', async () => {
    await grade(88);
    await queueChangedGrades(ASSIGNMENT);

    expect(await assignmentSyncState(ASSIGNMENT)).toMatchObject({
      linked: true,
      autoSync: true,
      pending: 1,
      sent: 0,
      failed: 0,
    });
  });

  it('reports an unlinked course, so the card can stay hidden', async () => {
    await prisma.ltiContextLink.deleteMany({});

    expect(await assignmentSyncState(ASSIGNMENT)).toMatchObject({ linked: false });
    expect(await courseIsLinked(UNLINKED_COURSE)).toBe(false);
  });
});
