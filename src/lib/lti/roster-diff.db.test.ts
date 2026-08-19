import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
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
const CONTEXT_LINK = 'cl-diff';
const SOURCE = { issuer: ISSUER, contextLinkId: CONTEXT_LINK };

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

const diff = (members: Member[]) =>
  diffRoster({ courseId: COURSE, sources: [{ ...SOURCE, members }] });

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

    const forStudent = result.changes.filter(
      (c) => 'userId' in c && c.userId === ids.student,
    );
    expect(forStudent).toHaveLength(1);
    expect(forStudent[0]?.kind).toBe('drop');
  });
});

/**
 * The restraint that matters most. Access is given in AFCT for reasons an LMS does not know
 * about, and removing a colleague mid-term because a Canvas section does not list them would
 * be worse than a stale row.
 */
/**
 * NRPS does not promise an email address, and AFCT cannot create an account without one.
 * Queuing an `add` for them threw inside the apply transaction and rolled back every other
 * change in the same sync.
 */
describe('somebody the LMS will not name', () => {
  it('is reported as impossible to import rather than queued for creation', async () => {
    const result = await diff([member({ ltiUserId: 'no-email-person', email: null })]);

    expect(result.changes).toContainEqual(
      expect.objectContaining({ kind: 'cannot-import', reason: 'no-email' }),
    );
    // And no attempt to create an account that would throw when applied.
    expect(result.changes.filter((c) => c.kind === 'add')).toHaveLength(0);
  });

  it('does not stop the valid changes in the same sync', async () => {
    const result = await diff([
      member({ ltiUserId: 'no-email-person', email: null }),
      member({ ltiUserId: 'newcomer', email: 'newcomer@example.test' }),
    ]);

    expect(result.changes.filter((c) => c.kind === 'add')).toHaveLength(1);
    expect(result.changes.filter((c) => c.kind === 'cannot-import')).toHaveLength(1);
  });

  /** Already in AFCT, so there is nothing to create and no reason to skip them. */
  it('is imported normally when AFCT already knows the person', async () => {
    await linkIdentity(ids.student, 'known-person');

    const result = await diff([member({ ltiUserId: 'known-person', email: null })]);

    expect(result.changes.filter((c) => c.kind === 'cannot-import')).toHaveLength(0);
  });
});

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

/**
 * A course opened by two LMS courses at once, which the Settings tab supports and cross-listed
 * sections produce. Reading one section and applying it used to mark the other section's
 * students as dropped, because the sync picked whichever connection came back first.
 */
describe('a course connected to more than one LMS course', () => {
  const SECOND_PLATFORM = 'ltip-diff-2';
  const SECOND_LINK = 'cl-diff-2';
  const SECOND_ISSUER = 'https://moodle.example.test';
  const secondSource = { issuer: SECOND_ISSUER, contextLinkId: SECOND_LINK };

  beforeEach(async () => {
    await prisma.ltiPlatform.create({
      data: {
        id: SECOND_PLATFORM,
        name: 'Moodle',
        issuer: SECOND_ISSUER,
        clientId: 'client-2',
        deploymentId: '1',
        authLoginUrl: `${SECOND_ISSUER}/auth`,
        tokenUrl: `${SECOND_ISSUER}/token`,
        keysetUrl: `${SECOND_ISSUER}/jwks`,
      },
    });
    await prisma.ltiContextLink.create({
      data: { id: SECOND_LINK, platformId: SECOND_PLATFORM, contextId: 'ctx-2', courseId: COURSE },
    });
  });

  afterEach(async () => {
    await prisma.ltiContextLink.deleteMany({ where: { platformId: SECOND_PLATFORM } });
    await prisma.ltiPlatform.deleteMany({ where: { id: SECOND_PLATFORM } });
    await prisma.linkedIdentity.deleteMany({ where: { issuer: SECOND_ISSUER } });
  });

  /**
   * The case that made this an aggregate rather than a loop.
   *
   * A student finishes one section and stays in another: the LMS lists them inactive in the
   * first and active in the second. Deciding per source dropped them the moment the first said
   * so, and the second saying otherwise arrived too late to matter.
   */
  it('keeps somebody who is inactive in one LMS course and active in another', async () => {
    await linkIdentity(ids.student, 'lms-first');

    const result = await diffRoster({
      courseId: COURSE,
      sources: [
        {
          ...SOURCE,
          members: [member({ ltiUserId: 'lms-first', active: false })],
        },
        {
          ...secondSource,
          members: [member({ ltiUserId: 'lms-second', email: 'student@example.test' })],
        },
      ],
    });

    expect(result.changes.filter((c) => c.kind === 'drop')).toHaveLength(0);
  });

  it('drops somebody only when no LMS course lists them active', async () => {
    await linkIdentity(ids.student, 'lms-first');

    const result = await diffRoster({
      courseId: COURSE,
      sources: [
        { ...SOURCE, members: [member({ ltiUserId: 'lms-first', active: false })] },
        {
          ...secondSource,
          members: [member({ ltiUserId: 'lms-second', email: 'student@example.test', active: false })],
        },
      ],
    });

    expect(result.changes.filter((c) => c.kind === 'drop')).toHaveLength(1);
  });

  /** The order the sources arrive in must not change the answer. */
  it('reaches the same answer whichever source is read first', async () => {
    await linkIdentity(ids.student, 'lms-first');

    const inactive = { ...SOURCE, members: [member({ ltiUserId: 'lms-first', active: false })] };
    const active = {
      ...secondSource,
      members: [member({ ltiUserId: 'lms-second', email: 'student@example.test' })],
    };

    const oneWay = await diffRoster({ courseId: COURSE, sources: [inactive, active] });
    const other = await diffRoster({ courseId: COURSE, sources: [active, inactive] });

    expect(oneWay.changes.filter((c) => c.kind === 'drop')).toHaveLength(0);
    expect(other.changes.filter((c) => c.kind === 'drop')).toHaveLength(0);
  });

  it('adds a person new to AFCT once, however many LMS courses hold them', async () => {
    const newcomer = { email: 'newcomer@example.test', firstName: 'New', lastName: 'Comer' };

    const result = await diffRoster({
      courseId: COURSE,
      sources: [
        { ...SOURCE, members: [member({ ltiUserId: 'lms-a', ...newcomer })] },
        { ...secondSource, members: [member({ ltiUserId: 'lms-b', ...newcomer })] },
      ],
    });

    expect(result.changes.filter((c) => c.kind === 'add')).toHaveLength(1);
  });

  it('gives somebody the more privileged of two roles, whichever order they arrive in', async () => {
    const person = { email: 'both@example.test' };

    const asStudentFirst = await diffRoster({
      courseId: COURSE,
      sources: [
        { ...SOURCE, members: [member({ ltiUserId: 'lms-a', ...person })] },
        {
          ...secondSource,
          members: [member({ ltiUserId: 'lms-b', ...person, roles: [`${R}#Instructor`] })],
        },
      ],
    });
    const asStaffFirst = await diffRoster({
      courseId: COURSE,
      sources: [
        {
          ...secondSource,
          members: [member({ ltiUserId: 'lms-b', ...person, roles: [`${R}#Instructor`] })],
        },
        { ...SOURCE, members: [member({ ltiUserId: 'lms-a', ...person })] },
      ],
    });

    const roleOf = (d: typeof asStudentFirst) =>
      d.changes.find((c): c is Extract<typeof c, { kind: 'add' }> => c.kind === 'add')?.role;
    expect(roleOf(asStudentFirst)).toBe('FACULTY');
    expect(roleOf(asStaffFirst)).toBe('FACULTY');
  });

  /**
   * The same id string from two platforms is two different people. Identities are keyed by
   * issuer as well as subject, and this is what proves it stays that way.
   */
  it('treats one subject string from two issuers as two people', async () => {
    await linkIdentity(ids.student, 'shared-id');

    const result = await diffRoster({
      courseId: COURSE,
      sources: [
        { ...SOURCE, members: [member({ ltiUserId: 'shared-id' })] },
        {
          ...secondSource,
          members: [member({ ltiUserId: 'shared-id', email: 'other@example.test' })],
        },
      ],
    });

    // The second is a stranger with their own address, so they are an addition, not the same row.
    expect(result.changes.filter((c) => c.kind === 'add')).toHaveLength(1);
  });

  it('takes the roster as the union of them, dropping nobody who is in the other', async () => {
    // Already enrolled in AFCT by the shared fixture, and listed only by the second LMS course.
    await linkIdentity(ids.student, 'lms-second');

    const result = await diffRoster({
      courseId: COURSE,
      sources: [
        { ...SOURCE, members: [member({ ltiUserId: 'lms-first', email: 'first@example.test' })] },
        {
          ...secondSource,
          members: [member({ ltiUserId: 'lms-second', email: 'student@example.test' })],
        },
      ],
    });

    // The one the first LMS course does not list is not dropped: the second one has them.
    expect(result.changes.filter((c) => c.kind === 'drop')).toHaveLength(0);
    expect(result.changes.filter((c) => c.kind === 'add')).toHaveLength(1);
  });

  it('remembers which LMS course each person came from', async () => {
    const result = await diffRoster({
      courseId: COURSE,
      sources: [
        { ...SOURCE, members: [member({ ltiUserId: 'lms-a', email: 'a@example.test' })] },
        { ...secondSource, members: [member({ ltiUserId: 'lms-b', email: 'b@example.test' })] },
      ],
    });

    // Applying an identity against the wrong platform is how a grade reaches the wrong
    // gradebook, so the source travels with the change rather than being assumed.
    const adds = result.changes.filter((c) => c.kind === 'add');
    expect(adds.map((c) => (c.kind === 'add' ? c.source.contextLinkId : null)).sort()).toEqual([
      CONTEXT_LINK,
      SECOND_LINK,
    ]);
  });

  it('matches an identity to the platform that issued it, not merely to the subject', async () => {
    // The same opaque subject from two platforms is two different people.
    await linkIdentity(ids.student, 'shared-subject');

    const result = await diffRoster({
      courseId: COURSE,
      sources: [
        {
          ...secondSource,
          members: [member({ ltiUserId: 'shared-subject', email: 'someone@example.test' })],
        },
      ],
    });

    // Not treated as the AFCT student who holds that subject on the *other* platform.
    expect(result.changes.some((c) => c.kind === 'add')).toBe(true);
    expect(result.changes.some((c) => c.kind === 'drop' && c.userId === ids.student)).toBe(true);
  });
});
