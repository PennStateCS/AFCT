/**
 * Working out which AFCT course a launch opens, and enrolling the person in it.
 *
 * A launch says which LMS course it came from, not which AFCT course that is. Somebody has to
 * decide once, and only somebody who already runs the AFCT course may: without that rule, a
 * launch becomes a way to attach a course you do not own and read its grades.
 */

import { errMessage } from '@/lib/errors';
import { prisma } from '@/lib/prisma';
// `Prisma` is a value here, not only a type: the error code below is read off it.
import { Prisma } from '@prisma/client';
import type { CourseRole } from '@prisma/client';
import type { LaunchIdentity } from '@/lib/lti/launch';
import type { AuditContext } from '@/lib/linked-identity';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';

/**
 * LTI role URIs, matched on their last segment.
 *
 * The vocabulary spells one role several ways: a context role is
 * `…/membership#Instructor`, an institution role `…/institution/person#Instructor`, and the
 * legacy form `urn:lti:role:ims/lis/Instructor` uses slashes throughout. Taking the last
 * segment covers all three, which is why matching is by suffix rather than by whole URI.
 *
 * Sub-roles arrive as `Instructor#TeachingAssistant`, so the segment after a `#` is what a
 * platform means most specifically; splitting on both separators reads that.
 */
const ROLE_SUFFIX: Record<string, CourseRole> = {
  Instructor: 'FACULTY',
  TeachingAssistant: 'TA',
  ContentDeveloper: 'FACULTY',
  Learner: 'STUDENT',
  Student: 'STUDENT',
  // Seen from real platforms and previously unrecognised, so they fell to STUDENT. A course
  // designer builds the course; a mentor or observer watches somebody else's work and is not
  // course staff, so it stays the least privileged reading.
  ContentDeveloper_ContentExpert: 'FACULTY',
  Administrator: 'FACULTY',
  Manager: 'FACULTY',
  Member: 'STUDENT',
  Mentor: 'STUDENT',
  Observer: 'STUDENT',
};

/**
 * The AFCT role for a set of LTI roles.
 *
 * The most privileged wins, because somebody who is both an instructor and a learner in an LMS
 * course (which happens, particularly in sandboxes) should not be demoted to a student.
 *
 * Applied **only when creating a roster entry**. A later launch never changes an existing role:
 * AFCT is the record of who runs a course, and an LMS role change should not silently demote
 * somebody mid-term.
 */
export function mapLtiRoles(roles: string[]): CourseRole {
  const mapped = roles
    // The most specific segment of the URI, whichever separator the platform used: `#` for a
    // sub-role or a vocabulary term, `/` for the legacy `urn:lti:role:ims/lis/Instructor`.
    .map((role) => ROLE_SUFFIX[role.split(/[#/]/).pop() ?? ''])
    .filter((role): role is CourseRole => Boolean(role));

  if (mapped.includes('FACULTY')) return 'FACULTY';
  if (mapped.includes('TA')) return 'TA';
  // Anything unrecognised is treated as a student: the least that could be meant, and the
  // only safe guess when a platform sends a role vocabulary we do not know.
  return 'STUDENT';
}

export type LaunchTarget =
  /** The LMS course is linked. Go here. */
  | { status: 'linked'; courseId: string }
  /** Not linked, and this person may choose. Offer the courses they manage. */
  | { status: 'needs-link' }
  /** Not linked, and this person may not choose. Somebody who runs the course must go first. */
  | { status: 'not-set-up' }
  /** The launch carried no course at all, so there is nothing to link. */
  | { status: 'no-context' };

/**
 * Where a launch would land, changing nothing.
 *
 * Exists for the administrator pause. An administrator's first launch is held for a password
 * before their LMS identity is attached, because an LMS asserting an administrator's email is
 * exactly the claim that pause exists to doubt. Working out where they were headed is a
 * courtesy AFCT does before asking, and it must be a read: {@link resolveLaunchTarget} records
 * that this person is in this LMS course, which is the assertion not yet proved.
 */
export async function peekLaunchTarget(opts: {
  identity: LaunchIdentity;
  userId: string;
}): Promise<LaunchTarget> {
  const { identity, userId } = opts;
  if (!identity.contextId) return { status: 'no-context' };

  const link = await prisma.ltiContextLink.findUnique({
    where: {
      platformId_contextId: { platformId: identity.platformId, contextId: identity.contextId },
    },
    select: { courseId: true },
  });
  if (link) return { status: 'linked', courseId: link.courseId };

  return (await canLinkCourses(userId)) ? { status: 'needs-link' } : { status: 'not-set-up' };
}

/**
 * Where a launch should land, for somebody already resolved to an AFCT account.
 *
 * Unlike {@link peekLaunchTarget} this records what the launch asserted: the service endpoints
 * the platform named this time, that this person is in this LMS course, which gradebook column
 * the link is bound to, and that the link itself is real. Only for a launch that has finished
 * establishing who somebody is, so an administrator held for a password confirms nothing on
 * that first launch and confirms it on the next one instead.
 */
export async function resolveLaunchTarget(opts: {
  identity: LaunchIdentity;
  userId: string;
}): Promise<LaunchTarget> {
  const { identity, userId } = opts;
  if (!identity.contextId) return { status: 'no-context' };

  const link = await prisma.ltiContextLink.findUnique({
    where: {
      platformId_contextId: { platformId: identity.platformId, contextId: identity.contextId },
    },
    select: { id: true, courseId: true, lineItemsUrl: true, membershipsUrl: true },
  });

  if (link) {
    // Refreshed per launch: the endpoint can move, and a stale one fails only when a grade is
    // eventually sent, long after anyone would connect the two.
    /**
     * The launch's own service claims say what AFCT may use for this context, so an endpoint
     * that has stopped being advertised is cleared rather than kept. Keeping it meant a
     * revoked grade or roster permission went on being used until the platform refused, which
     * surfaces much later and nowhere near the cause.
     */
    const changed =
      identity.lineItemsUrl !== link.lineItemsUrl ||
      identity.membershipsUrl !== link.membershipsUrl;
    if (changed) {
      await prisma.ltiContextLink.update({
        where: { id: link.id },
        data: {
          lineItemsUrl: identity.lineItemsUrl,
          membershipsUrl: identity.membershipsUrl,
        },
      });
    }
    // A launch is the LMS saying this person is in this course. Recorded so a grade can be
    // sent to the right gradebook when the AFCT course is open from more than one LMS course.
    await rememberContextMember({
      contextLinkId: link.id,
      userId,
      ltiUserId: identity.subject,
    });

    await rememberNamedLineItem({
      contextLinkId: link.id,
      courseId: link.courseId,
      assignmentId: identity.assignmentId,
      lineItemUrl: identity.lineItemUrl,
    });

    await confirmDeepLink({
      contextLinkId: link.id,
      assignmentId: identity.assignmentId,
    });

    return { status: 'linked', courseId: link.courseId };
  }

  return (await canLinkCourses(userId)) ? { status: 'needs-link' } : { status: 'not-set-up' };
}

/**
 * Note that the LMS really did keep a link AFCT handed it.
 *
 * AFCT writes the `LtiDeepLink` row when it returns the deep linking response, which is the
 * last moment it hears anything: the browser carries the signed response to the platform, and
 * whether the platform stored it is never reported back. Moodle refused three in a row while
 * its keyset fetch was broken, and AFCT went on believing three assignments were linked.
 *
 * A launch arriving through the link is the proof, and the only one there is. It is also the
 * reason this is not a `create`: a launch must never invent a link, only confirm one that the
 * picker already wrote and already checked belonged to this course.
 *
 * Best effort, like the two writes beside it. A confirm that fails costs nothing, because the
 * next launch through the same link does it instead.
 */
async function confirmDeepLink(opts: {
  contextLinkId: string;
  assignmentId: string | null;
}): Promise<void> {
  // A plain course link names no assignment, so there is nothing here to confirm.
  if (!opts.assignmentId) return;

  try {
    /**
     * `confirmedAt: null` in the filter rather than in a read beforehand, so the first launch
     * is the one recorded and a burst of them cannot overwrite each other. It also means this
     * costs nothing on every later launch, which is almost all of them.
     */
    await prisma.ltiDeepLink.updateMany({
      where: {
        contextLinkId: opts.contextLinkId,
        assignmentId: opts.assignmentId,
        confirmedAt: null,
      },
      data: { confirmedAt: new Date() },
    });
  } catch (error) {
    console.warn('[lti] could not confirm the link this launch came through', errMessage(error));
  }
}

/**
 * Record the gradebook column the platform named for this link.
 *
 * AGS sends `lineitem` on a resource link launch once the platform has bound a column to that
 * link, and it is the platform's own answer to "which column is this assignment's". Taking it
 * here means sending a grade needs no search at all: no dependence on the platform supporting a
 * `resource_id` filter, and no way to adopt the wrong column, which is how a grade once landed on
 * a second assignment of the same name.
 *
 * Best effort, like the membership write beside it. A launch that works must not fail because
 * this did; the cost of it failing is a search later, which is the behaviour without it.
 */
async function rememberNamedLineItem(opts: {
  contextLinkId: string;
  courseId: string;
  assignmentId: string | null;
  lineItemUrl: string | null;
}): Promise<void> {
  if (!opts.assignmentId || !opts.lineItemUrl) return;

  try {
    /**
     * The assignment has to be in the course this link opens.
     *
     * The id arrives in a custom claim, which travels through the platform and could name an
     * assignment anywhere. Writing a column against another course's assignment would send that
     * course's grades into this LMS course, so it is checked rather than trusted, exactly as the
     * launch destination checks it.
     */
    const assignment = await prisma.assignment.findFirst({
      where: { id: opts.assignmentId, courseId: opts.courseId },
      select: { id: true },
    });
    if (!assignment) return;

    /**
     * `label` and `scoreMaximum` are deliberately left alone.
     *
     * They record what the column was last *told* it is called and worth, which is how a renamed
     * or re-pointed assignment is noticed and corrected. The platform naming a URL says nothing
     * about either, so writing them here would claim a sync that never happened.
     */
    await prisma.ltiLineItem.upsert({
      where: {
        contextLinkId_assignmentId: {
          contextLinkId: opts.contextLinkId,
          assignmentId: opts.assignmentId,
        },
      },
      create: {
        contextLinkId: opts.contextLinkId,
        assignmentId: opts.assignmentId,
        url: opts.lineItemUrl,
      },
      update: { url: opts.lineItemUrl },
    });
  } catch (error) {
    console.warn('[lti] could not record the column the launch named', errMessage(error));
  }
}

/**
 * Note that somebody belongs to an LMS course.
 *
 * Best effort: a launch that works must not fail because this write did. The worst case is a
 * grade that cannot be placed later, which reports itself.
 */
export async function rememberContextMember(opts: {
  contextLinkId: string;
  userId: string;
  ltiUserId: string;
  tx?: Prisma.TransactionClient;
}): Promise<void> {
  const client = opts.tx ?? prisma;
  try {
    await client.ltiContextMember.upsert({
      where: {
        contextLinkId_userId: { contextLinkId: opts.contextLinkId, userId: opts.userId },
      },
      create: {
        contextLinkId: opts.contextLinkId,
        userId: opts.userId,
        ltiUserId: opts.ltiUserId,
      },
      update: { ltiUserId: opts.ltiUserId, seenAt: new Date() },
    });
  } catch (error) {
    console.error('[lti] could not record context membership:', error);
  }
}

/**
 * The one database error these paths expect: a row that already exists.
 *
 * Matched on Prisma's code rather than the message, and narrowly, so an outage or a broken
 * foreign key travels on to the caller as a failure rather than being read as "somebody got
 * here first".
 */
function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

/** Course staff: the roles that may connect an LMS course to a course they are on. */
const LINKING_ROLES: CourseRole[] = ['FACULTY', 'TA'];

/**
 * Whether this person may link an LMS course to an AFCT one.
 *
 * Admins, and course staff on at least one course. TAs are included: they are the ones setting
 * a course up often enough that excluding them mostly produced a dead end, and a TA already
 * reads and grades everything in their course, so the LMS connection is not a new power. It is
 * still per course, not in general: see {@link linkLaunchCourse}.
 */
async function canLinkCourses(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { isAdmin: true } });
  if (user?.isAdmin) return true;

  const staff = await prisma.roster.count({ where: { userId, role: { in: LINKING_ROLES } } });
  return staff > 0;
}

/**
 * How many courses this person could pick from, which decides whether asking is any use.
 *
 * Somebody allowed to link but with nothing to link it to should not be shown an empty picker;
 * they are sent to their dashboard and told what is missing. An administrator may link any
 * course, so for them this is the number of courses that exist.
 */
export async function linkableCourseCount(userId: string): Promise<number> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { isAdmin: true } });

  return prisma.course.count({
    where: {
      deletedAt: null,
      ...(user?.isAdmin
        ? {}
        : { roster: { some: { userId, role: { in: LINKING_ROLES } } } }),
    },
  });
}

export type LinkRefusal = 'not-allowed' | 'already-linked' | 'no-context';

/**
 * Attach an LMS course to an AFCT course.
 *
 * The permission check is on **this course**, not on courses in general: somebody who runs one
 * course must not be able to attach an LMS course to a different one. Admins may link any.
 */
export async function linkLaunchCourse(opts: {
  identity: LaunchIdentity;
  courseId: string;
  userId: string;
  context: AuditContext;
}): Promise<{ ok: true } | { ok: false; reason: LinkRefusal }> {
  const { identity, courseId, userId, context } = opts;
  if (!identity.contextId) return { ok: false, reason: 'no-context' };

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { isAdmin: true } });
  if (!user?.isAdmin) {
    const staffHere = await prisma.roster.count({
      where: { userId, courseId, role: { in: LINKING_ROLES } },
    });
    if (staffHere === 0) return { ok: false, reason: 'not-allowed' };
  }

  try {
    await prisma.ltiContextLink.create({
      data: {
        platformId: identity.platformId,
        contextId: identity.contextId,
        contextTitle: identity.contextTitle,
        courseId,
        lineItemsUrl: identity.lineItemsUrl,
        membershipsUrl: identity.membershipsUrl,
        linkedByUserId: userId,
      },
    });
  } catch (error) {
    // The unique constraint, rather than a check-then-create that two simultaneous launches
    // could both pass. Only that: telling somebody their course is "already linked" because
    // the database was unreachable sends them looking for a link that does not exist.
    if (!isUniqueConstraintError(error)) throw error;
    return { ok: false, reason: 'already-linked' };
  }

  // Logged to match unlinking: deciding which AFCT course an LMS opens governs whose grades
  // flow where, and only one half of that was recorded before.
  await createEnhancedActivityLog(prisma, context, {
    userId,
    courseId,
    action: 'LTI_COURSE_LINKED',
    severity: 'WARNING',
    category: 'COURSE',
    metadata: { platformId: identity.platformId, contextId: identity.contextId },
  });

  return { ok: true };
}

/**
 * Put the person on the course roster if they are not already there.
 *
 * Deliberately never changes an existing entry. A student who dropped stays dropped until
 * somebody in AFCT re-enrols them, and a role set here is set once: see {@link mapLtiRoles}.
 */
export async function enrolFromLaunch(opts: {
  courseId: string;
  userId: string;
  roles: string[];
}): Promise<{ created: boolean; role: CourseRole }> {
  const { courseId, userId, roles } = opts;

  const existing = await prisma.roster.findUnique({
    where: { courseId_userId: { courseId, userId } },
    select: { role: true },
  });
  if (existing) return { created: false, role: existing.role };

  const role = mapLtiRoles(roles);
  try {
    await prisma.roster.create({ data: { courseId, userId, role } });
  } catch (error) {
    /**
     * Only the duplicate is expected: two launches at once, where the constraint decided and
     * this one lost. Anything else (the database gone, a foreign key that does not hold) was
     * being swallowed and answered with a role nobody had written, so a launch went on to
     * open a course the person was not enrolled in.
     */
    if (!isUniqueConstraintError(error)) throw error;

    const settled = await prisma.roster.findUnique({
      where: { courseId_userId: { courseId, userId } },
      select: { role: true },
    });
    // The constraint said the row exists, so its absence here is not a race, it is a fault.
    // Reporting a role anyway would claim an enrolment that does not exist.
    if (!settled) {
      throw new Error(`Roster row for ${userId} in ${courseId} vanished after a duplicate insert`);
    }
    return { created: false, role: settled.role };
  }

  return { created: true, role };
}

/**
 * Delete pending links that were never acted on.
 *
 * A launch from an unlinked LMS course leaves one of these behind whenever somebody closes the
 * tab instead of choosing. They are short-lived and scoped to one person, so nothing depends on
 * them surviving, but without a sweep they accumulate for ever.
 */
export async function purgeExpiredPendingLinks(now = new Date()): Promise<number> {
  const { count } = await prisma.ltiPendingLink.deleteMany({
    where: { expiresAt: { lt: now } },
  });
  return count;
}
