import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withCourseAuth } from '@/lib/api/with-auth';
import { apiError } from '@/lib/api/http';
import { assignmentLmsLinks } from '@/lib/lti/links';

/**
 * Which LMS courses open this assignment.
 *
 * Staff only, and course-scoped: the assignment has to belong to the course in the path, so a
 * link cannot be read by asking a course you run about somebody else's assignment.
 *
 * @openapi
 * summary: LMS links that open this assignment
 * parameters:
 *   - { name: id, in: path, required: true, schema: { type: string } }
 *   - { name: aid, in: path, required: true, schema: { type: string } }
 * responses:
 *   200: { description: The LMS courses this assignment has been added to. }
 *   401: { description: Not signed in. }
 *   403: { description: Not course staff or a system admin. }
 *   404: { description: No such assignment in this course. }
 */
export const GET = withCourseAuth(
  async (_req, ctx, { courseId }) => {
    const { aid } = await ctx.params;
    if (!aid) return apiError(400, 'Missing params');

    const assignment = await prisma.assignment.findFirst({
      where: { id: aid, courseId },
      select: { id: true },
    });
    if (!assignment) return apiError(404, 'Not found');

    return NextResponse.json({ links: await assignmentLmsLinks(assignment.id) });
  },
  { access: 'manage', deniedAction: 'LTI_DEEP_LINK_VIEW_DENIED' },
);
