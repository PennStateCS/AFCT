import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';
import { withCourseAuth } from '@/lib/api/with-auth';

/**
 * Lists a course's groups, alphabetically. Course staff (faculty or TAs) or a
 * system admin.
 * @openapi
 * summary: List course groups
 * parameters:
 *   - { name: id, in: path, required: true, schema: { type: string } }
 * responses:
 *   200:
 *     description: The course's groups.
 *     content:
 *       application/json:
 *         schema: { type: array, items: { type: object } }
 *   401: { description: Not signed in. }
 *   403: { description: Not course staff or a system admin. }
 *   500: { description: Server error. }
 */
export const GET = withCourseAuth(
  async (req, _ctx, { user, courseId }) => {
    try {
      const groups = await prisma.group.findMany({
        where: { courseId },
        orderBy: { name: 'asc' },
      });

      await createEnhancedActivityLog(prisma, req, {
        userId: user.id,
        action: 'VIEW_GROUPS',
        severity: 'INFO',
        category: 'COURSE',
        metadata: { courseId },
      });

      return NextResponse.json(groups);
    } catch (err) {
      console.error('[COURSE_GROUPS_GET_ERROR]', err);
      return NextResponse.json({ error: 'Failed to fetch groups' }, { status: 500 });
    }
  },
  { access: 'manage', deniedAction: 'COURSE_GROUPS_VIEW_DENIED' },
);

/**
 * Creates a group in the course. Course staff (faculty or TAs) or a system admin.
 * Group names are unique per course.
 * @openapi
 * summary: Create a course group
 * parameters:
 *   - { name: id, in: path, required: true, schema: { type: string } }
 * requestBody:
 *   required: true
 *   content:
 *     application/json:
 *       schema:
 *         type: object
 *         properties:
 *           name: { type: string, description: New group name }
 * responses:
 *   201: { description: The created group. }
 *   401: { description: Not signed in. }
 *   403: { description: Not course staff or a system admin. }
 *   404: { description: Course not found. }
 *   409: { description: A group with that name already exists in the course. }
 *   400: { description: Missing group name. }
 *   500: { description: Server error. }
 */
export const POST = withCourseAuth(
  async (req, _ctx, { user, courseId }) => {
    try {
      const data = await req.json();

      const name = (data.name ?? '').trim();

      if (!name) return NextResponse.json({ error: 'Name is required' }, { status: 400 });

      // Ensure course exists
      const course = await prisma.course.findUnique({ where: { id: courseId } });
      if (!course) return NextResponse.json({ error: 'Course not found' }, { status: 404 });

      // Prevent duplicates (composite unique: [courseId, name])
      const exists = await prisma.group.findUnique({
        where: { courseId_name: { courseId, name } },
      });
      if (exists)
        return NextResponse.json(
          { error: 'Group name already exists for this course' },
          { status: 409 },
        );

      const group = await prisma.group.create({ data: { name, courseId } });

      await createEnhancedActivityLog(prisma, req, {
        userId: user.id,
        action: 'CREATE_GROUP',
        severity: 'INFO',
        category: 'COURSE',
        metadata: { courseId, groupId: group.id },
      });

      return NextResponse.json(group, { status: 201 });
    } catch (err) {
      console.error('[COURSE_GROUPS_POST_ERROR]', err);
      await createEnhancedActivityLog(prisma, req, {
        userId: user.id,
        action: 'GROUP_CREATE_ERROR',
        severity: 'ERROR',
        metadata: { error: err instanceof Error ? err.message : 'unknown error' },
      });
      return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
  },
  { access: 'manage', deniedAction: 'GROUP_CREATE_DENIED', blockWhenArchived: true },
);
