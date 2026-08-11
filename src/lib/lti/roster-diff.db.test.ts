import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/prisma';
import { diffRoster } from './roster-diff';
import type { Member } from './nrps';

/**
 * Comparing an LMS roster against AFCT's, against a real Postgres.
 *
 * This decides who can read student work, so the tests that matter are about restraint: who is
 * *not* touched. Nobody is deleted, and course staff are not removed because a Canvas section
 * does not list them.
 */

const ISSUER = 'https://canvas.example.test';
const COURSE = 'c-diff';
const ids = {
  student: 'u-diff-student',
  dropped: 'u-diff-dropped',
  ta: 'u-diff-ta',
  faculty: 'u-diff-faculty',
  stranger: 'u-diff-stranger',
};

const R = 'http://purl.imsglobal.org/vocab/lis/v2/membership';

const member = (over: Partial<Member> = {}): Member => ({
  ltiUserId: 'lms-student',
  email: 'student@example.test',
  firstName: 'Ada',
  lastName: 'Lovelace',
  roles: [`${R}#Learner`],
  active: true,
  ...over,
});

async function destroyFixtures() {
  await prisma.linkedIdentity.deleteMany({ where: { issuer: ISSUER } });
  await prisma.roster.deleteMany({ where: { courseId: COURSE } });
  await prisma.course.deleteMany({ where: { id: COURSE } });
  await prisma.user.deleteMany({ where: { id: { in: Object.values(ids) } } });
}

beforeEach(async () => {
  await destroyFixtures();
  await prisma.user.createMany({
    data: [
      { id: ids.student, email: 'student@example.test', password: null },
      { id: ids.dropped, email: 'dropped@example.test', password: null },
      { id: ids.ta, email: 'ta@example.test', password: null },
      { id: ids.faculty, email: 'faculty@example.test', password: null },
      { id: ids.stranger, email: 'stranger@example.test', password: null },
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
  await prisma.roster.createMany({
    data: [
      { courseId: COURSE, userId: ids.student, role: 'STUDENT' },
      { courseId: COURSE, userId: ids.dropped, role: 'STUDENT', status: 'DROPPED' },
      { courseId: COURSE, userId: ids.ta, role: 'TA' },
      { courseId: COURSE, userId: ids.faculty, role: 'FACULTY' },
    ],
  });
});

afterAll(async () => {
  await destroyFixtures();
  await prisma.$disconnect();
});

const diff = (members: Member[]) => diffRoster({ courseId: COURSE, issuer: ISSUER, members });

const linkIdentity = (userId: string, subject: string) =>
  prisma.linkedIdentity.create({
    data: { userId, kind: 'LTI', issuer: ISSUER, subject, linkedVia: 'JUST_IN_TIME' },
  });

describe('somebody the LMS lists', () => {
  it('is added when AFCT has never seen them', async () => {
    const result = await diff([member({ ltiUserId: 'lms-new', email: 'new@example.test' })]);

    expect(result.changes).toContainEqual(
      expect.objectContaining({ kind: 'add', role: 'STUDENT', existingUserId: null }),
    );
  });

  // An account already exists; only the enrolment is missing.
  it('is added against their existing account when the address matches', async () => {
    const result = await diff([member({ ltiUserId: 'lms-x', email: 'stranger@example.test' })]);

    expect(result.changes).toContainEqual(
      expect.objectContaining({ kind: 'add', existingUserId: ids.stranger }),
    );
  });

  /**
   * The point of the whole phase: a student who has never launched has no LMS identity, so
   * their grades cannot be sent. Sync is what fills that in for a whole class at once.
   */
  it('gets their LMS identity linked when that is all that is missing', async () => {
    const result = await diff([member()]);

    expect(result.changes).toContainEqual(
      expect.objectContaining({
        kind: 'link-identity',
        userId: ids.student,
        ltiUserId: 'lms-student',
      }),
    );
  });

  it('is left alone once enrolled and linked', async () => {
    await linkIdentity(ids.student, 'lms-student');

    const result = await diff([member()]);

    expect(result.changes).toEqual([]);
    expect(result.unchanged).toBe(1);
  });

  it('is restored when they had dropped and the LMS says otherwise', async () => {
    const result = await diff([member({ ltiUserId: 'lms-back', email: 'dropped@example.test' })]);

    expect(result.changes).toContainEqual(
      expect.objectContaining({ kind: 'restore', userId: ids.dropped }),
    );
  });

  /**
   * The LMS id wins over the address, and this is the case that proves it: the id belongs to
   * one person while the address now belongs to another, which happens when an institution
   * reassigns an address. Matching on the address first would enrol the wrong person and, once
   * grades flow, send somebody else's marks.
   */
  it('follows the LMS id when the address belongs to somebody else', async () => {
    await linkIdentity(ids.student, 'lms-student');

    const result = await diff([member({ email: 'stranger@example.test' })]);

    // Recognised as the student they are, so nothing to change; the stranger is untouched.
    expect(result.changes).toEqual([]);
    expect(result.unchanged).toBe(1);
  });
});

describe('somebody the LMS no longer lists', () => {
  it('is dropped when the LMS reports them inactive', async () => {
    const result = await diff([member({ active: false })]);

    expect(result.changes).toContainEqual(
      expect.objectContaining({ kind: 'drop', userId: ids.student }),
    );
  });

  it('is dropped when the LMS omits them entirely', async () => {
    const result = await diff([]);

    expect(result.changes).toContainEqual(
      expect.objectContaining({ kind: 'drop', userId: ids.student }),
    );
  });

  // Dropped, never removed: their work and grades survive and re-enrolling restores them.
  it('is only ever proposed for a drop, never anything harsher', async () => {
    const result = await diff([]);

    const forStudent = result.changes.filter((c) => c.kind !== 'add' && c.userId === ids.student);
    expect(forStudent).toHaveLength(1);
    expect(forStudent[0]?.kind).toBe('drop');
  });
});

/**
 * The restraint that matters most. Access is given in AFCT for reasons an LMS does not know
 * about, and removing a colleague mid-term because a Canvas section does not list them would
 * be worse than a stale row.
 */
describe('course staff the LMS does not list', () => {
  it('are kept, not dropped', async () => {
    const result = await diff([]);

    const dropped = result.changes.filter((c) => c.kind === 'drop').map((c) => c.userId);
    expect(dropped).not.toContain(ids.ta);
    expect(dropped).not.toContain(ids.faculty);
  });

  it('are reported, so the difference is not silent', async () => {
    const result = await diff([]);

    expect(result.keptStaff.map((s) => s.role).sort()).toEqual(['FACULTY', 'TA']);
  });
});

describe('roles', () => {
  it('adds an instructor as faculty rather than a student', async () => {
    const result = await diff([
      member({ ltiUserId: 'lms-prof', email: 'prof@example.test', roles: [`${R}#Instructor`] }),
    ]);

    expect(result.changes).toContainEqual(
      expect.objectContaining({ kind: 'add', role: 'FACULTY' }),
    );
  });
});
