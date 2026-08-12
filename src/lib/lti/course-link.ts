/**
 * Working out which AFCT course a launch opens, and enrolling the person in it.
 *
 * A launch says which LMS course it came from, not which AFCT course that is. Somebody has to
 * decide once, and only somebody who already runs the AFCT course may: without that rule, a
 * launch becomes a way to attach a course you do not own and read its grades.
 */

import { prisma } from '@/lib/prisma';
import type { CourseRole, Prisma } from '@prisma/client';
import type { LaunchIdentity } from '@/lib/lti/launch';
import type { AuditContext } from '@/lib/linked-identity';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';

/** LTI role URIs, which are long and repetitive, matched on their last segment. */
const ROLE_SUFFIX: Record<string, CourseRole> = {
  Instructor: 'FACULTY',
  TeachingAssistant: 'TA',
  ContentDeveloper: 'FACULTY',
  Learner: 'STUDENT',
  Student: 'STUDENT',
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
    .map((role) => ROLE_SUFFIX[role.split('#').pop() ?? ''])
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

/** Where a launch should land, for somebody already resolved to an AFCT account. */
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

    return { status: 'linked', courseId: link.courseId };
  }

  return (await canLinkCourses(userId)) ? { status: 'needs-link' } : { status: 'not-set-up' };
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
 * Whether this person may link an LMS course to an AFCT one.
 *
 * Admins, and faculty on at least one course. **TAs may not**, even though they otherwise read
 * what faculty read: this is configuration, not coursework.
 */
async function canLinkCourses(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { isAdmin: true } });
  if (user?.isAdmin) return true;

  const faculty = await prisma.roster.count({ where: { userId, role: 'FACULTY' } });
  return faculty > 0;
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
    const runsThisCourse = await prisma.roster.count({
      where: { userId, courseId, role: 'FACULTY' },
    });
    if (runsThisCourse === 0) return { ok: false, reason: 'not-allowed' };
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
  } catch {
    // The unique constraint, rather than a check-then-create that two simultaneous launches
    // could both pass.
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
  } catch {
    // Two launches at once. The constraint decided; read back what it settled on.
    const settled = await prisma.roster.findUnique({
      where: { courseId_userId: { courseId, userId } },
      select: { role: true },
    });
    return { created: false, role: settled?.role ?? role };
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
