import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withCourseAuth } from '@/lib/api/with-auth';

/**
 * Lists every group membership for the course in one call — the aggregate that
 * replaces fetching each group's members separately when resolving which group a
 * student belongs to. Course staff (faculty or TAs) or a system admin. Returns the
 * raw (userId, groupId) pairs; callers that need a userId→group map build it in
 * their own preferred group order.
 * @openapi
 * summary: List all group memberships for a course
 * parameters:
 *   - { name: id, in: path, required: true, schema: { type: string } }
 * responses:
 *   200:
 *     description: All (userId, groupId) membership pairs for the course.
 *     content:
 *       application/json:
 *         schema:
 *           type: object
 *           properties:
 *             memberships:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   userId: { type: string }
 *                   groupId: { type: string }
 *   401: { description: Not signed in. }
 *   403: { description: Not course staff or a system admin. }
 *   500: { description: Server error. }
 */
export const GET = withCourseAuth(
  async (_req, _ctx, { courseId }) => {
    try {
      const memberships = await prisma.groupRoster.findMany({
        where: { courseId },
        select: { userId: true, groupId: true },
        orderBy: { createdAt: 'asc' },
      });
      return NextResponse.json({ memberships });
    } catch (err) {
      console.error('GET /api/courses/[id]/group-memberships error:', err);
      return NextResponse.json({ error: 'Failed to fetch group memberships' }, { status: 500 });
    }
  },
  { access: 'manage', deniedAction: 'GROUP_MEMBERSHIPS_VIEW_DENIED' },
);
