import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { auth } from '@/lib/auth';
import { readJson } from '@/lib/api/request';
import { apiError } from '@/lib/api/http';
import { linkLaunchCourse } from '@/lib/lti/course-link';

const LinkSchema = z.object({
  pendingId: z.string().min(1),
  courseId: z.string().min(1),
});

/**
 * Say which AFCT course an LMS course opens.
 *
 * The LMS course identifier comes from the stored pending link, never from the request. That is
 * the whole point of storing it: if the caller supplied it, somebody could name a *different*
 * LMS course and capture its launches.
 * @openapi
 * summary: Link the LMS course from a pending launch to an AFCT course
 * description: >-
 *   Where the course picker a first launch lands on posts its choice. The LMS course comes from
 *   the pending record the launch stored, never from this request, so a caller cannot name a
 *   different LMS course and capture its launches; only the AFCT course is chosen here. The
 *   grade and roster endpoints the launch advertised are stored on the link, which is what
 *   makes grade passback and roster sync possible later.
 * requestBody:
 *   required: true
 *   content:
 *     application/json:
 *       schema:
 *         type: object
 *         required: [pendingId, courseId]
 *         properties:
 *           pendingId: { type: string, description: The pending link the launch created. }
 *           courseId: { type: string, description: The AFCT course this LMS course should open. }
 * responses:
 *   200: { description: Linked. Launches from that LMS course now open the chosen course. }
 *   400: { description: The pending launch has expired or is not yours. }
 *   401: { description: Not signed in. }
 *   403: { description: You can only connect a course you teach. }
 *   409: { description: That LMS course is already linked to another AFCT course. }
 */
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return apiError(401, 'Not signed in');

  const body = await readJson(request, LinkSchema);
  if (!body.ok) return body.response;

  const pending = await prisma.ltiPendingLink.findFirst({
    // Scoped to the caller, so somebody else's pending launch is simply not found.
    where: { id: body.data.pendingId, userId: session.user.id, expiresAt: { gt: new Date() } },
    include: { platform: { select: { issuer: true } } },
  });

  if (!pending) {
    return apiError(400, 'That launch has expired. Open the link in your LMS again.');
  }

  const result = await linkLaunchCourse({
    identity: {
      platformId: pending.platformId,
      contextId: pending.contextId,
      contextTitle: pending.contextTitle,
      // Where grades and the roster live for this course, as the launch reported them. These
      // are emphatically NOT unused by linking: they are stored on the link and are the only
      // route to the gradebook afterwards. Passing null here recorded a course that looked
      // connected and could never be graded, and the failure then blamed the LMS for a
      // permission it had already given.
      lineItemsUrl: pending.lineItemsUrl,
      membershipsUrl: pending.membershipsUrl,
      // Connecting a course is not a launch through a link, so there is no per-link column to
      // name. One appears on the first launch that opens an assignment.
      lineItemUrl: null,
      // The rest is genuinely unused by linking, and deliberately not carried around: this is
      // a configuration act, not a sign-in.
      issuer: pending.platform.issuer,
      subject: '',
      email: '',
      firstName: null,
      lastName: null,
      roles: [],
      resourceLinkId: null,
      deepLink: null,
      assignmentId: null,
      targetLinkUri: null,
    },
    courseId: body.data.courseId,
    userId: session.user.id,
    context: request,
  });

  if (!result.ok) {
    if (result.reason === 'already-linked') {
      return apiError(
        409,
        'That LMS course is already linked to a different AFCT course. Ask an administrator if it needs changing.',
      );
    }
    return apiError(403, 'You can only connect a course you teach.');
  }

  // Deliberately no enrolment here. Faculty who linked it are on the course already, and an
  // admin who is not reaches it by being an admin. Enrolling with no LTI roles to map would
  // make them a student on a course they just configured.
  await prisma.ltiPendingLink.delete({ where: { id: pending.id } });

  return NextResponse.json({ courseId: body.data.courseId });
}
