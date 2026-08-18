import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withCourseAuth } from '@/lib/api/with-auth';
import { apiError } from '@/lib/api/http';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';
import { platformLabel } from '@/lib/lti/link-labels';

/**
 * Forget that an assignment was added to an LMS course.
 *
 * This changes nothing in the LMS and cannot: the link there carries the assignment id as a
 * custom parameter, so it goes on opening the same assignment whether or not this record
 * exists. All the record does is stop the picker offering that assignment again, which is what
 * makes removing it necessary. If the LMS never accepted the response, or somebody deleted the
 * activity afterwards, AFCT is left believing an assignment is linked when nothing opens it,
 * and there was no way to say otherwise.
 *
 * Deleting the LMS activity is the other half of the job and belongs to whoever runs the LMS
 * course, so the screen says so rather than implying this did it.
 *
 * @openapi
 * summary: Remove a record that this assignment is in an LMS course
 * parameters:
 *   - { name: id, in: path, required: true, schema: { type: string } }
 *   - { name: aid, in: path, required: true, schema: { type: string } }
 *   - { name: linkId, in: path, required: true, schema: { type: string } }
 * responses:
 *   200: { description: Removed. }
 *   401: { description: Not signed in. }
 *   403: { description: Not course staff or a system admin. }
 *   404: { description: No such link on an assignment in this course. }
 *   409: { description: The course is archived. }
 */
export const DELETE = withCourseAuth(
  async (req, ctx, { user, courseId }) => {
    const { aid, linkId } = await ctx.params;
    if (!aid || !linkId) return apiError(400, 'Missing params');

    // Matched on all three at once, so a link id from another course is a 404 rather than a
    // delete: the course gate alone would not catch it.
    const link = await prisma.ltiDeepLink.findFirst({
      where: { id: linkId, assignmentId: aid, assignment: { courseId } },
      select: {
        id: true,
        assignment: { select: { id: true, title: true } },
        contextLink: {
          select: {
            contextTitle: true,
            platform: { select: { name: true, issuer: true } },
          },
        },
      },
    });
    if (!link) return apiError(404, 'Not found');

    await prisma.ltiDeepLink.delete({ where: { id: link.id } });

    await createEnhancedActivityLog(prisma, req, {
      userId: user.id,
      courseId,
      assignmentId: link.assignment.id,
      action: 'LTI_DEEP_LINK_REMOVED',
      severity: 'INFO',
      category: 'COURSE',
      metadata: {
        issuer: link.contextLink.platform.issuer,
        assignmentTitle: link.assignment.title,
        contextTitle: link.contextLink.contextTitle,
        platform: platformLabel(link.contextLink.platform),
      },
    });

    return NextResponse.json({ ok: true });
  },
  {
    access: 'manage',
    deniedAction: 'LTI_DEEP_LINK_REMOVE_DENIED',
    blockWhenArchived: true,
  },
);
