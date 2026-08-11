import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/prisma';
import { applyRosterChanges } from './roster-apply';
import { diffRoster } from './roster-diff';
import type { Member } from './nrps';

/**
 * Applying an LMS roster, against a real Postgres.
 *
 * This is the only part of roster sync that changes anything, and what it changes is who can
 * read student work. The tests are about that: nothing is deleted, applying twice does nothing
 * the second time, and a person who existed before is not duplicated.
 */

const ISSUER = 'https://canvas.example.test';
const COURSE = 'c-apply';
const CONTEXT = { ipAddress: '10.0.0.1', userAgent: 'test' };
const ids = { actor: 'u-apply-actor', student: 'u-apply-student', existing: 'u-apply-existing' };
const R = 'http://purl.imsglobal.org/vocab/lis/v2/membership';

const member = (over: Partial<Member> = {}): Member => ({
  ltiUserId: 'lms-new',
  email: 'new@example.test',
  firstName: 'Ada',
  lastName: 'Lovelace',
  roles: [`${R}#Learner`],
  active: true,
  ...over,
});

async function destroyFixtures() {
  await prisma.activityLog.deleteMany({ where: { courseId: COURSE } });
  await prisma.linkedIdentity.deleteMany({ where: { issuer: ISSUER } });
  await prisma.roster.deleteMany({ where: { courseId: COURSE } });
  await prisma.course.deleteMany({ where: { id: COURSE } });
  await prisma.user.deleteMany({
    where: { OR: [{ id: { in: Object.values(ids) } }, { email: { contains: '@example.test' } }] },
  });
}

beforeEach(async () => {
  await destroyFixtures();
  await prisma.user.createMany({
    data: [
      { id: ids.actor, email: 'actor@example.test', password: 'x' },
      { id: ids.student, email: 'student@example.test', password: null },
      { id: ids.existing, email: 'existing@example.test', password: null },
    ],
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
});

afterAll(async () => {
  await destroyFixtures();
  await prisma.$disconnect();
});

/** Diff then apply, the way the screen will. */
async function sync(members: Member[]) {
  const { changes } = await diffRoster({ courseId: COURSE, issuer: ISSUER, members });
  return applyRosterChanges({
    courseId: COURSE,
    issuer: ISSUER,
    changes,
    actorUserId: ids.actor,
    context: CONTEXT,
  });
}

describe('adding somebody the LMS lists', () => {
  it('creates an account, enrols them, and attaches their LMS identity', async () => {
    const result = await sync([member()]);

    expect(result).toMatchObject({ added: 1, accountsCreated: 1, identitiesLinked: 1 });
    const user = await prisma.user.findUniqueOrThrow({ where: { email: 'new@example.test' } });
    expect(user.password).toBeNull();
    expect(await prisma.roster.count({ where: { courseId: COURSE, userId: user.id } })).toBe(1);
  });

  /**
   * The whole point of the phase: a student who has never launched now has the identity a
   * grade is posted against, so their marks can reach the LMS.
   */
  it('gives an existing account its LMS identity without making a second account', async () => {
    const result = await sync([member({ email: 'existing@example.test', ltiUserId: 'lms-e' })]);

    expect(result).toMatchObject({ accountsCreated: 0, identitiesLinked: 1 });
    expect(await prisma.user.count({ where: { email: 'existing@example.test' } })).toBe(1);
    const identity = await prisma.linkedIdentity.findFirstOrThrow({ where: { issuer: ISSUER } });
    expect(identity.userId).toBe(ids.existing);
  });

  it('adds an instructor as faculty', async () => {
    await sync([member({ roles: [`${R}#Instructor`], email: 'prof@example.test' })]);

    const row = await prisma.roster.findFirstOrThrow({ where: { courseId: COURSE } });
    expect(row.role).toBe('FACULTY');
  });
});

describe('somebody the LMS drops', () => {
  // Dropped, not deleted: their work and grades survive and re-enrolling restores them.
  it('is marked dropped, and their record stays', async () => {
    await prisma.roster.create({
      data: { courseId: COURSE, userId: ids.student, role: 'STUDENT' },
    });

    const result = await sync([]);

    expect(result.dropped).toBe(1);
    const row = await prisma.roster.findFirstOrThrow({ where: { userId: ids.student } });
    expect(row.status).toBe('DROPPED');
    expect(row.droppedAt).not.toBeNull();
  });

  it('is restored when the LMS lists them again', async () => {
    await prisma.roster.create({
      data: { courseId: COURSE, userId: ids.student, role: 'STUDENT', status: 'DROPPED' },
    });

    await sync([member({ email: 'student@example.test', ltiUserId: 'lms-s' })]);

    const row = await prisma.roster.findFirstOrThrow({ where: { userId: ids.student } });
    expect(row.status).toBe('ENROLLED');
    expect(row.droppedAt).toBeNull();
  });
});

/** Rosters are synced repeatedly, so a second run has to be a no-op rather than a second set. */
describe('running it twice', () => {
  it('changes nothing the second time', async () => {
    await sync([member()]);

    const second = await sync([member()]);

    expect(second).toMatchObject({ added: 0, dropped: 0, identitiesLinked: 0, accountsCreated: 0 });
    expect(await prisma.user.count({ where: { email: 'new@example.test' } })).toBe(1);
    expect(await prisma.roster.count({ where: { courseId: COURSE } })).toBe(1);
  });
});

describe('what it refuses to decide', () => {
  /**
   * An LMS id already attached elsewhere is left alone. Moving an identity between accounts
   * would silently hand one person's grades to another, and is not a roster sync's call.
   *
   * Applied directly rather than through the diff, because that is the situation this guards:
   * a preview somebody approved, and by the time they pressed apply the identity had been
   * claimed by whoever launched in the meantime.
   */
  it('never moves an LMS identity from one account to another', async () => {
    await prisma.linkedIdentity.create({
      data: {
        userId: ids.student,
        kind: 'LTI',
        issuer: ISSUER,
        subject: 'lms-shared',
        linkedVia: 'JUST_IN_TIME',
      },
    });

    await applyRosterChanges({
      courseId: COURSE,
      issuer: ISSUER,
      // A stale change: it names a different account than the one that now owns this id.
      changes: [
        {
          kind: 'link-identity',
          userId: ids.existing,
          name: 'Someone else',
          ltiUserId: 'lms-shared',
        },
      ],
      actorUserId: ids.actor,
      context: CONTEXT,
    });

    const identity = await prisma.linkedIdentity.findFirstOrThrow({
      where: { subject: 'lms-shared' },
    });
    expect(identity.userId).toBe(ids.student);
  });
});

/**
 * Counts alone cannot answer "was this student dropped, and when", which is what both a support
 * request and a FERPA disclosure record turn on.
 */
describe('the record it leaves for each person', () => {
  it('names who was added, using the same action as enrolling by hand', async () => {
    await sync([member()]);

    const user = await prisma.user.findUniqueOrThrow({ where: { email: 'new@example.test' } });
    const entry = await prisma.activityLog.findFirstOrThrow({
      where: { action: 'ENROLL_USER', courseId: COURSE },
    });
    expect(entry.metadata).toMatchObject({ targetUserId: user.id, via: 'LTI_ROSTER_SYNC' });
  });

  it('names who was dropped', async () => {
    await prisma.roster.create({
      data: { courseId: COURSE, userId: ids.student, role: 'STUDENT' },
    });

    await sync([]);

    const entry = await prisma.activityLog.findFirstOrThrow({
      where: { action: 'DROP_FROM_COURSE', courseId: COURSE },
    });
    expect(entry.metadata).toMatchObject({ targetUserId: ids.student, via: 'LTI_ROSTER_SYNC' });
  });

  it('names whose sign-in was connected', async () => {
    await sync([member({ email: 'existing@example.test', ltiUserId: 'lms-e' })]);

    const entry = await prisma.activityLog.findFirstOrThrow({
      where: { action: 'IDENTITY_LINKED', courseId: COURSE },
    });
    expect(entry.metadata).toMatchObject({ targetUserId: ids.existing, subject: 'lms-e' });
  });

  // The administrator ran the sync; the student is who it was about.
  it('records the person who ran it as the actor throughout', async () => {
    await sync([member()]);

    const entries = await prisma.activityLog.findMany({ where: { courseId: COURSE } });
    expect(entries.every((e) => e.userId === ids.actor)).toBe(true);
  });
});

/** A privileged change to who can see student work, so it is always recorded. */
describe('the record it leaves', () => {
  it('logs the sync against the person who ran it', async () => {
    await sync([member()]);

    const entry = await prisma.activityLog.findFirstOrThrow({
      where: { action: 'LTI_ROSTER_SYNCED' },
    });
    expect(entry.userId).toBe(ids.actor);
    expect(entry.severity).toBe('WARNING');
    expect(entry.metadata).toMatchObject({ added: 1, accountsCreated: 1 });
  });
});
