import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { auth } from '@/lib/auth';
import { readJson } from '@/lib/api/request';
import { apiError } from '@/lib/api/http';
import { canManageCourse } from '@/lib/permissions';
import { fetchMembership, nrpsFailureMessage, type Member } from '@/lib/lti/nrps';
import { diffRoster } from '@/lib/lti/roster-diff';
import { applyRosterChanges } from '@/lib/lti/roster-apply';

/**
 * Reading and applying an LMS roster.
 *
 * `GET` previews and changes nothing; `POST` applies. Split because this decides who can see
 * student work, so somebody reads the difference before it happens.
 */

async function gate(courseId: string) {
  const session = await auth();
  // `inactive` as well as the id: a revoked session keeps its user id so the app can say who
  // it was, and `canManageCourse` answers what a person may do, never whether their session is
  // still good. Same rule as the auth wrappers.
  if (!session?.user?.id || session.user.inactive)
    return { ok: false as const, response: apiError(401, 'Not signed in') };
  if (!(await canManageCourse(session.user, courseId))) {
    return { ok: false as const, response: apiError(403, 'Forbidden') };
  }

  /**
   * Every LMS course that opens this one, not one of them.
   *
   * Cross-listed sections are separate courses in an LMS and all of them open the same AFCT
   * course, which the Settings tab lists and supports. Reading one and applying it would mark
   * everybody in the others as dropped, so the roster is the union of them all.
   */
  const links = await prisma.ltiContextLink.findMany({
    where: { courseId },
    include: { platform: { select: { id: true, clientId: true, tokenUrl: true, issuer: true } } },
    orderBy: { createdAt: 'asc' },
  });
  if (links.length === 0)
    return {
      ok: false as const,
      response: apiError(404, 'This course is not connected to an LMS.'),
    };

  return { ok: true as const, links, userId: session.user.id };
}

/** Read the LMS roster and work out what applying it would do. */
async function preview(
  courseId: string,
  links: NonNullable<Awaited<ReturnType<typeof gate>>['links']>,
) {
  const sources: { issuer: string; contextLinkId: string; members: Member[] }[] = [];

  for (const link of links) {
    const membership = await fetchMembership({
      platform: link.platform,
      membershipsUrl: link.membershipsUrl,
      // The roster has to be for the LMS course this link opens, or it would be applied to the
      // wrong AFCT course: everyone in the answer enrolled, everyone who belongs here dropped.
      expectedContextId: link.contextId,
    });
    /**
     * One unreadable LMS course fails the whole sync.
     *
     * A partial union is indistinguishable from a smaller roster, and the difference decides
     * who gets marked dropped. Refusing is recoverable; applying half a roster is not.
     */
    if (!membership.ok) {
      return { ok: false as const, message: nrpsFailureMessage(membership.reason) };
    }
    sources.push({
      issuer: link.platform.issuer,
      contextLinkId: link.id,
      members: membership.members,
    });
  }

  const diff = await diffRoster({ courseId, sources });
  // The rosters travel with the preview so the apply can take its own diff inside the
  // transaction that writes, rather than trusting one computed out here.
  return { ok: true as const, diff, sources };
}

/**
 * @openapi
 * summary: What syncing this course's roster from the LMS would change
 * responses:
 *   200: { description: The changes that would be made. Nothing is changed. }
 *   403: { description: You do not manage this course. }
 *   404: { description: This course is not connected to an LMS. }
 *   502: { description: The LMS could not be read. }
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const allowed = await gate(id);
  if (!allowed.ok) return allowed.response;

  const result = await preview(id, allowed.links);
  if (!result.ok) return apiError(502, result.message);

  return NextResponse.json(result.diff);
}

const ApplySchema = z.object({
  /** Nothing is applied without this: the changes are read before they happen. */
  confirm: z.literal(true),
});

/**
 * Apply the roster.
 *
 * Deliberately re-reads the LMS rather than trusting a diff posted back from the browser. What
 * gets applied is what the LMS says now, not what a page said some minutes ago, and it means a
 * caller cannot hand-craft a set of changes.
 * @openapi
 * summary: Sync this course's roster from the LMS
 * responses:
 *   200: { description: What was changed. }
 *   403: { description: You do not manage this course. }
 *   404: { description: This course is not connected to an LMS. }
 *   502: { description: The LMS could not be read. }
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const allowed = await gate(id);
  if (!allowed.ok) return allowed.response;

  const body = await readJson(request, ApplySchema);
  if (!body.ok) return body.response;

  const result = await preview(id, allowed.links);
  if (!result.ok) return apiError(502, result.message);

  /**
   * The LMS rosters go in, not the diff.
   *
   * `preview` already fetched them, which is the slow part and cannot be done inside a
   * transaction anyway. What must not happen outside one is comparing them against AFCT's own
   * roster: that read used to sit here, so a student dropped or enrolled by hand between the
   * preview and the apply was overwritten by a decision taken before it happened. Handing over
   * the sources lets the diff be taken inside the transaction that acts on it.
   *
   * Only ever from a fresh, complete read: preview refuses if any LMS source failed, and a
   * partial roster cannot tell "no longer in this section" from "could not ask".
   */
  const applied = await applyRosterChanges({
    courseId: id,
    sources: result.sources,
    actorUserId: allowed.userId,
    context: request,
  });

  return NextResponse.json(applied);
}
