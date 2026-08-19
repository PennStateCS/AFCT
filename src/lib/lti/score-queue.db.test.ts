import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/prisma';
import {
  queueScore,
  claimNextScore,
  markSent,
  markFailed,
  scoreQueueSummary,
  MAX_ATTEMPTS,
} from './score-queue';

/**
 * The queue of grades on their way to an LMS, against a real Postgres.
 *
 * These are grades, so the failures that matter are the quiet ones: a score sent twice, a score
 * dropped, or a failure nobody can see. The concurrency case needs real rows and a real
 * constraint, which is why it lives here rather than against a mock.
 */

const COURSE = 'c-queue';
const ASSIGNMENT = 'a-queue';
const OTHER_ASSIGNMENT = 'a-queue-2';
const USERS = ['u-queue-1', 'u-queue-2'];

async function destroyFixtures() {
  // The failure log these tests now write, or a count from the previous test carries over.
  await prisma.activityLog.deleteMany({
    where: { action: { in: ['LTI_SCORE_SEND_FAILED', 'LTI_SCORE_QUEUED', 'LTI_SCORE_SENT'] } },
  });
  await prisma.ltiScoreQueue.deleteMany({});
  await prisma.assignment.deleteMany({ where: { id: { in: [ASSIGNMENT, OTHER_ASSIGNMENT] } } });
  await prisma.course.deleteMany({ where: { id: COURSE } });
  await prisma.user.deleteMany({ where: { id: { in: USERS } } });
}

beforeEach(async () => {
  await destroyFixtures();
  await prisma.user.createMany({
    data: USERS.map((id) => ({ id, email: `${id}@example.test`, password: null })),
  });
  await prisma.course.create({
    data: {
      id: COURSE,
      name: 'Theory',
      code: 'CMPSC 464',
      semester: 'Fall 2026',
      credits: 3,
      startDate: new Date('2026-08-24T00:00:00Z'),
      endDate: new Date('2026-12-18T00:00:00Z'),
    },
  });
  await prisma.assignment.createMany({
    data: [
      { id: ASSIGNMENT, courseId: COURSE, title: 'Problem set 1', dueDate: new Date() },
      { id: OTHER_ASSIGNMENT, courseId: COURSE, title: 'Problem set 2', dueDate: new Date() },
    ],
  });
});

afterAll(async () => {
  await destroyFixtures();
  await prisma.$disconnect();
});

const queue = (userId = USERS[0]!, scoreGiven = 80) =>
  queueScore({ assignmentId: ASSIGNMENT, userId, scoreGiven, scoreMaximum: 100 });

describe('queueing a grade', () => {
  it('records what to send', async () => {
    await queue();

    const row = await prisma.ltiScoreQueue.findFirstOrThrow();
    expect(row).toMatchObject({ scoreGiven: 80, scoreMaximum: 100, state: 'PENDING', attempts: 0 });
  });

  /**
   * The LMS should receive the current grade, not a history of edits, so a regrade replaces
   * what was waiting rather than queueing behind it.
   */
  it('replaces a grade that has not been sent yet', async () => {
    await queue(USERS[0], 80);
    await queue(USERS[0], 95);

    const rows = await prisma.ltiScoreQueue.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.scoreGiven).toBe(95);
  });

  // A new grade deserves a fresh run at it, even if the previous one had given up.
  it('revives one that had failed', async () => {
    await queue();
    await prisma.ltiScoreQueue.updateMany({
      data: { state: 'FAILED', attempts: MAX_ATTEMPTS, lastError: 'gave up' },
    });

    await queue(USERS[0], 95);

    const row = await prisma.ltiScoreQueue.findFirstOrThrow();
    expect(row).toMatchObject({ state: 'PENDING', attempts: 0, lastError: null });
  });

  it('keeps students apart', async () => {
    await queue(USERS[0]);
    await queue(USERS[1]);

    expect(await prisma.ltiScoreQueue.count()).toBe(2);
  });
});

describe('claiming the next one', () => {
  it('takes the oldest due grade and counts the attempt', async () => {
    await queue();

    const claimed = await claimNextScore();

    expect(claimed?.assignmentId).toBe(ASSIGNMENT);
    expect(claimed?.attempts).toBe(1);
  });

  it('leaves alone anything not due yet', async () => {
    await queue();
    await prisma.ltiScoreQueue.updateMany({
      data: { nextAttemptAt: new Date(Date.now() + 60_000) },
    });

    expect(await claimNextScore()).toBeNull();
  });

  it('ignores grades already sent or given up on', async () => {
    await queue(USERS[0]);
    await queue(USERS[1]);
    await prisma.ltiScoreQueue.updateMany({
      where: { userId: USERS[0] },
      data: { state: 'SENT' },
    });
    await prisma.ltiScoreQueue.updateMany({
      where: { userId: USERS[1] },
      data: { state: 'FAILED' },
    });

    expect(await claimNextScore()).toBeNull();
  });

  /**
   * The case this design exists for. Two senders running at once must not both take the same
   * row, or the LMS receives the same score twice and the second overwrites a grade that may
   * have changed in between.
   *
   * This one only ever caught half of it: both reads land before either write, so they collide
   * on the attempt count and one loses. Whether that happens is down to how the two queries
   * interleave, so passing here never proved much. The test below is the half it missed.
   */
  it('is taken by exactly one of two senders racing', async () => {
    await queue();

    const [first, second] = await Promise.all([claimNextScore(), claimNextScore()]);

    const claimed = [first, second].filter(Boolean);
    expect(claimed).toHaveLength(1);
  });

  /**
   * A second sender arriving *after* the first has claimed, which is the ordering the old guard
   * let through: the row stayed PENDING and still due, so the newcomer read the bumped attempt
   * count and claimed it again quite happily. Both would then call `ensureLineItem`, and two of
   * those racing can each create a gradebook column.
   *
   * Deterministic, unlike the race above: the first claim has definitely finished.
   */
  it('is not handed out again while the first sender still holds it', async () => {
    await queue();

    const first = await claimNextScore();
    const second = await claimNextScore();

    expect(first).not.toBeNull();
    expect(second).toBeNull();
  });

  /** The lease lapses, so a sender that died holding a grade does not strand it for ever. */
  it('becomes available again once the claim has lapsed', async () => {
    await queue();
    await claimNextScore();

    // Six minutes on, past the five-minute lease.
    const later = new Date(Date.now() + 6 * 60 * 1000);

    expect(await claimNextScore(later)).not.toBeNull();
  });
});

describe('after an attempt', () => {
  it('marks a delivered grade sent', async () => {
    await queue();
    const claimed = await claimNextScore();

    await markSent({
      id: claimed!.id,
      claimToken: claimed!.claimToken,
      scoreGiven: claimed!.scoreGiven,
      scoreMaximum: claimed!.scoreMaximum,
    });

    const row = await prisma.ltiScoreQueue.findFirstOrThrow();
    expect(row.state).toBe('SENT');
    expect(row.sentAt).not.toBeNull();
  });

  it('schedules a retry for something worth retrying', async () => {
    await queue();
    const claimed = await claimNextScore();

    const result = await markFailed({
      id: claimed!.id,
      claimToken: claimed!.claimToken,
      attempts: claimed!.attempts,
      error: 'ECONNREFUSED',
      retryable: true,
    });

    expect(result.state).toBe('PENDING');
    const row = await prisma.ltiScoreQueue.findFirstOrThrow();
    expect(row.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());
    expect(row.lastError).toContain('ECONNREFUSED');
  });

  /**
   * A refused grade will be refused again in five minutes. Retrying it wastes a day before
   * anyone is told, when the fix is a person changing a registration.
   */
  it('gives up at once on something that will not improve', async () => {
    await queue();
    const claimed = await claimNextScore();

    const result = await markFailed({
      id: claimed!.id,
      claimToken: claimed!.claimToken,
      attempts: claimed!.attempts,
      error: 'the LMS refused it',
      retryable: false,
    });

    expect(result.state).toBe('FAILED');
  });

  it('gives up once it has tried enough times', async () => {
    await queue();
    const claimed = await claimNextScore();

    const result = await markFailed({
      id: claimed!.id,
      claimToken: claimed!.claimToken,
      attempts: MAX_ATTEMPTS,
      error: 'still unreachable',
      retryable: true,
    });

    expect(result.state).toBe('FAILED');
  });

  it('backs off further each time', async () => {
    await queue();
    const now = new Date('2026-08-11T00:00:00Z');

    // Claimed again between attempts, as a retry does: a failure releases the claim, and the
    // outcome of a send can only be recorded against the claim that send holds.
    const first = await claimNextScore();
    await markFailed({
      id: first!.id,
      claimToken: first!.claimToken,
      attempts: 1,
      error: 'x',
      retryable: true,
      now,
    });
    const firstDue = (await prisma.ltiScoreQueue.findFirstOrThrow()).nextAttemptAt.getTime();

    const second = await claimNextScore(new Date(Date.now() + 60 * 60_000));
    await markFailed({
      id: second!.id,
      claimToken: second!.claimToken,
      attempts: 3,
      error: 'x',
      retryable: true,
      now,
    });
    const laterDue = (await prisma.ltiScoreQueue.findFirstOrThrow()).nextAttemptAt.getTime();

    expect(laterDue).toBeGreaterThan(firstDue);
  });
});

/** What faculty see. A failure nobody can find is the same as a grade that never went. */
/**
 * A grade changed while its send was in flight.
 *
 * The queue keeps one row per student per assignment, so a regrade reuses the row the sender is
 * holding. Recording the outcome by row id alone therefore recorded it against a grade that
 * send never carried: the new score marked SENT, the log saying it was delivered, the LMS still
 * holding the old one, and nothing left to send it. The queue and the audit trail agreed with
 * each other and both were wrong, which is the worst shape a grade bug can take.
 */
describe('a grade that changes mid-send', () => {
  it('does not let the finished send mark the new grade delivered', async () => {
    await queue(USERS[0]!, 80);
    const claimed = await claimNextScore();

    // The instructor regrades while that send is out.
    await queue(USERS[0]!, 90);

    // ...and the old send now finishes, having delivered 80.
    const outcome = await markSent({
      id: claimed!.id,
      claimToken: claimed!.claimToken,
      scoreGiven: claimed!.scoreGiven,
      scoreMaximum: claimed!.scoreMaximum,
    });

    expect(outcome).toBe('stale');
    const row = await prisma.ltiScoreQueue.findFirstOrThrow();
    expect(row.state).toBe('PENDING');
    expect(row.scoreGiven).toBe(90);
    expect(row.sentAt).toBeNull();
  });

  it('does not log the new grade as the one that arrived', async () => {
    await queue(USERS[0]!, 80);
    const claimed = await claimNextScore();
    await queue(USERS[0]!, 90);

    await markSent({
      id: claimed!.id,
      claimToken: claimed!.claimToken,
      scoreGiven: claimed!.scoreGiven,
      scoreMaximum: claimed!.scoreMaximum,
    });

    const sentEntries = await prisma.activityLog.findMany({
      where: { action: 'LTI_SCORE_SENT' },
      select: { metadata: true },
    });
    expect(sentEntries).toHaveLength(0);
  });

  it('does not let a stale failure push back the grade that replaced it', async () => {
    await queue(USERS[0]!, 80);
    const claimed = await claimNextScore();
    await queue(USERS[0]!, 90);

    await markFailed({
      id: claimed!.id,
      claimToken: claimed!.claimToken,
      attempts: claimed!.attempts,
      error: 'the LMS refused it',
      retryable: false,
    });

    // The new grade is still due, and still going out: an old send's failure is not its failure.
    const row = await prisma.ltiScoreQueue.findFirstOrThrow();
    expect(row.state).toBe('PENDING');
    expect(row.scoreGiven).toBe(90);
    expect(row.nextAttemptAt.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
  });

  /** The ordinary case still works: nothing changed, so the send records itself. */
  it('records a send whose grade nobody touched', async () => {
    await queue(USERS[0]!, 80);
    const claimed = await claimNextScore();

    const outcome = await markSent({
      id: claimed!.id,
      claimToken: claimed!.claimToken,
      scoreGiven: claimed!.scoreGiven,
      scoreMaximum: claimed!.scoreMaximum,
    });

    expect(outcome).toBe('sent');
    expect((await prisma.ltiScoreQueue.findFirstOrThrow()).state).toBe('SENT');
  });
});

describe('what somebody troubleshooting can see', () => {
  /**
   * Three facts, not one. A grade changing, a grade being accepted for sending, and a grade
   * arriving are different events, and a log holding only the last cannot tell "never queued"
   * from "queued and still waiting" — which is the question that came up the first time a grade
   * did not appear in an LMS gradebook.
   */
  it('records a grade being queued for the LMS', async () => {
    await queue();

    const entry = await prisma.activityLog.findFirst({
      where: { action: 'LTI_SCORE_QUEUED' },
      select: { severity: true, courseId: true, assignmentId: true, metadata: true },
    });
    expect(entry?.severity).toBe('INFO');
    expect(entry?.courseId).toBeTruthy();
    expect(entry?.assignmentId).toBeTruthy();
    expect(JSON.stringify(entry?.metadata)).toContain('scoreGiven');
  });

  it('records a grade the LMS accepted', async () => {
    // The ordinary case, so INFO: it must not compete for attention with the failures.
    await queue();
    const claimed = await claimNextScore();

    await markSent({
      id: claimed!.id,
      claimToken: claimed!.claimToken,
      scoreGiven: claimed!.scoreGiven,
      scoreMaximum: claimed!.scoreMaximum,
    });

    const entry = await prisma.activityLog.findFirst({
      where: { action: 'LTI_SCORE_SENT' },
      select: { severity: true, assignmentId: true },
    });
    expect(entry?.severity).toBe('INFO');
    expect(entry?.assignmentId).toBeTruthy();
  });

  /**
   * A grade that will never reach the LMS gradebook is one of the worst things this system can
   * do quietly. The reason used to live only on the queue row, which no screen reads, so
   * finding out why grades were not arriving needed a database prompt.
   */
  it('logs a grade it has given up on, with the reason', async () => {
    await queue();
    const claimed = await claimNextScore();

    await markFailed({
      id: claimed!.id,
      claimToken: claimed!.claimToken,
      attempts: claimed!.attempts,
      error: 'Your LMS did not give AFCT permission to write grades for this course.',
      retryable: false,
    });

    const entry = await prisma.activityLog.findFirst({
      where: { action: 'LTI_SCORE_SEND_FAILED' },
      select: { severity: true, courseId: true, assignmentId: true, metadata: true },
    });
    expect(entry?.severity).toBe('ERROR');
    // Filterable by course and assignment, or faculty cannot find their own.
    expect(entry?.courseId).toBeTruthy();
    expect(entry?.assignmentId).toBeTruthy();
    expect(JSON.stringify(entry?.metadata)).toContain('permission to write grades');
  });

  it('stays quiet about an attempt it is going to retry', async () => {
    // A transient error the next attempt fixes is noise, and noise is what stops this log
    // being read at all.
    await queue();
    const claimed = await claimNextScore();

    await markFailed({
      id: claimed!.id,
      claimToken: claimed!.claimToken,
      attempts: claimed!.attempts,
      error: 'ECONNREFUSED',
      retryable: true,
    });

    expect(await prisma.activityLog.count({ where: { action: 'LTI_SCORE_SEND_FAILED' } })).toBe(0);
  });
});

describe('the summary for an assignment', () => {
  it('counts what is waiting, sent and failed', async () => {
    await queue(USERS[0]);
    await queue(USERS[1]);
    const claimed = await claimNextScore();
    await markSent({
      id: claimed!.id,
      claimToken: claimed!.claimToken,
      scoreGiven: claimed!.scoreGiven,
      scoreMaximum: claimed!.scoreMaximum,
    });

    const summary = await scoreQueueSummary(ASSIGNMENT);

    expect(summary).toMatchObject({ pending: 1, sent: 1, failed: 0 });
    expect(summary.lastSentAt).not.toBeNull();
  });

  it('counts only this assignment', async () => {
    await queue(USERS[0]);
    await queueScore({
      assignmentId: OTHER_ASSIGNMENT,
      userId: USERS[1]!,
      scoreGiven: 50,
      scoreMaximum: 100,
    });

    expect(await scoreQueueSummary(ASSIGNMENT)).toMatchObject({ pending: 1 });
  });

  it('says nothing has been sent when nothing has', async () => {
    await queue();

    expect((await scoreQueueSummary(ASSIGNMENT)).lastSentAt).toBeNull();
  });
});
