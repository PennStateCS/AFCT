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
 * responses:
 *   200: { description: Linked. }
 *   400: { description: The pending launch has expired or is not yours. }
 *   403: { description: You do not run that course. }
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
      // The rest is unused by linking, and deliberately not carried around: this is a
      // configuration act, not a sign-in.
      issuer: pending.platform.issuer,
      subject: '',
      email: '',
      firstName: null,
      lastName: null,
      roles: [],
      resourceLinkId: null,
      lineItemsUrl: null,
      targetLinkUri: null,
    },
    courseId: body.data.courseId,
    userId: session.user.id,
  });

  if (!result.ok) {
    if (result.reason === 'already-linked') {
      return apiError(
        409,
        'That LMS course is already linked to a different AFCT course. Ask an administrator if it needs changing.',
      );
    }
    return apiError(403, 'You can only link a course you teach.');
  }

  // Deliberately no enrolment here. Faculty who linked it are on the course already, and an
  // admin who is not reaches it by being an admin. Enrolling with no LTI roles to map would
  // make them a student on a course they just configured.
  await prisma.ltiPendingLink.delete({ where: { id: pending.id } });

  return NextResponse.json({ courseId: body.data.courseId });
}
