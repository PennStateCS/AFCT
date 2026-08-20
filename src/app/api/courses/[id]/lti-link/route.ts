import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { auth } from '@/lib/auth';
import { apiError } from '@/lib/api/http';
import { canManageCourse } from '@/lib/permissions';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';

async function staffFor(courseId: string) {
  const session = await auth();
  if (!session?.user?.id) return { ok: false as const, response: apiError(401, 'Not signed in') };
  const allowed = await canManageCourse(session.user, courseId);
  if (!allowed) return { ok: false as const, response: apiError(403, 'Forbidden') };
  return { ok: true as const, user: session.user };
}

/**
 * Which LMS courses open this AFCT course.
 *
 * More than one is normal: cross-listed sections are separate courses in the LMS and one
 * course to the department.
 * @openapi
 * summary: The LMS courses linked to this course
 * responses:
 *   200:
 *     description: "The links, empty when none. `lineItemsUrl` says whether the LMS granted grade services for that course."
 *     content:
 *       application/json:
 *         schema:
 *           type: object
 *           properties:
 *             links:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   id: { type: string }
 *                   contextTitle: { type: string, nullable: true, description: The LMS course's own name. }
 *                   contextId: { type: string, description: The LMS's identifier for the course. }
 *                   createdAt: { type: string }
 *                   lineItemsUrl: { type: string, nullable: true }
 *                   platform: { type: object, properties: { name: { type: string } } }
 *                   linkedBy: { type: string, nullable: true, description: Who connected it. }
 *   401: { description: Not signed in. }
 *   403: { description: You do not manage this course. }
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const gate = await staffFor(id);
  if (!gate.ok) return gate.response;

  const links = await prisma.ltiContextLink.findMany({
    where: { courseId: id },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      contextTitle: true,
      contextId: true,
      createdAt: true,
      lineItemsUrl: true,
      platform: { select: { name: true } },
      linkedBy: { select: { firstName: true, lastName: true, email: true } },
    },
  });

  return NextResponse.json({
    links: links.map((link) => ({
      id: link.id,
      platformName: link.platform.name,
      contextTitle: link.contextTitle,
      contextId: link.contextId,
      linkedAt: link.createdAt,
      // Whether grades can be sent at all, which is the question faculty actually have.
      canSendGrades: link.lineItemsUrl !== null,
      linkedBy: link.linkedBy
        ? `${link.linkedBy.firstName ?? ''} ${link.linkedBy.lastName ?? ''}`.trim() ||
          link.linkedBy.email
        : null,
    })),
  });
}

/**
 * Disconnect an LMS course from this one.
 *
 * Removes the link and the gradebook columns AFCT remembers, not any grade already sent. A
 * later launch from that LMS course asks which AFCT course it is, as if for the first time.
 * @openapi
 * summary: Disconnect an LMS course from this course
 * parameters:
 *   - { in: query, name: linkId, required: true, schema: { type: string }, description: Which link to remove. }
 * responses:
 *   200: { description: "Disconnected. Grades already sent stay in the LMS; a later launch from that LMS course asks which AFCT course it is, as if for the first time." }
 *   400: { description: No linkId was given. }
 *   401: { description: Not signed in. }
 *   403: { description: You do not manage this course. }
 *   404: { description: No such link on this course. }
 */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const gate = await staffFor(id);
  if (!gate.ok) return gate.response;

  const linkId = new URL(request.url).searchParams.get('linkId');
  if (!linkId) return apiError(400, 'Which link?');

  // Scoped to this course, so an id from elsewhere removes nothing.
  const { count } = await prisma.ltiContextLink.deleteMany({
    where: { id: linkId, courseId: id },
  });
  if (count === 0) return apiError(404, 'Not found');

  await createEnhancedActivityLog(prisma, request, {
    userId: gate.user.id,
    courseId: id,
    action: 'LTI_COURSE_UNLINKED',
    severity: 'WARNING',
    category: 'COURSE',
    metadata: { linkId },
  });

  return NextResponse.json({ success: true });
}
