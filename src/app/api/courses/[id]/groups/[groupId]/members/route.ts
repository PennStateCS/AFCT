import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';
import { withCourseAuth } from '@/lib/api/with-auth';

/**
 * Lists a group's members, oldest first. Course staff (faculty or TAs) or a system
 * admin. The group must belong to the course in the path.
 * @openapi
 * summary: List group members
 * parameters:
 *   - { name: id, in: path, required: true, schema: { type: string } }
 *   - { name: groupId, in: path, required: true, schema: { type: string } }
 * responses:
 *   200:
 *     description: The group's members.
 *     content:
 *       application/json:
 *         schema: { type: object, properties: { members: { type: array, items: { type: object } } } }
 *   401: { description: Not signed in. }
 *   403: { description: Not course staff or a system admin. }
 *   404: { description: Group not found in this course. }
 *   500: { description: Server error. }
 */
export const GET = withCourseAuth(
  async (req, ctx, { user, courseId }) => {
    const { groupId } = await ctx.params;

    if (!groupId) return NextResponse.json({ error: 'Missing params' }, { status: 400 });

    try {
      // Ensure group exists and belongs to the course
      const group = await prisma.group.findUnique({ where: { id: groupId } });
      if (!group || group.courseId !== courseId)
        return NextResponse.json({ error: 'Group not found for course' }, { status: 404 });

      const members = await prisma.groupRoster.findMany({
        where: { groupId },
        orderBy: { createdAt: 'asc' },
      });

      await createEnhancedActivityLog(prisma, req, {
        userId: user.id,
        action: 'VIEW_GROUP_MEMBERS',
        severity: 'INFO',
        category: 'COURSE',
        metadata: { courseId, groupId },
      });

      return NextResponse.json({ members });
    } catch (err) {
      console.error('[GROUP_MEMBERS_GET_ERROR]', err);
      return NextResponse.json({ error: 'Failed to fetch members' }, { status: 500 });
    }
  },
  { access: 'manage', deniedAction: 'GROUP_MEMBERS_VIEW_DENIED' },
);

/**
 * Adds one user to a group. Course staff (faculty or TAs) or a system admin. The
 * user must already be enrolled in the course; the upsert makes re-adding a no-op.
 * @openapi
 * summary: Add a group member
 * parameters:
 *   - { name: id, in: path, required: true, schema: { type: string } }
 *   - { name: groupId, in: path, required: true, schema: { type: string } }
 * requestBody:
 *   required: true
 *   content:
 *     application/json:
 *       schema: { type: object, required: [userId], properties: { userId: { type: string } } }
 * responses:
 *   201: { description: Member added. }
 *   401: { description: Not signed in. }
 *   403: { description: Not course staff or a system admin. }
 *   404: { description: Group not found in this course. }
 *   422: { description: "Missing userId, or the user isn't enrolled in the course." }
 *   500: { description: Server error. }
 */
export const POST = withCourseAuth(
  async (req, ctx, { user, courseId }) => {
    const { groupId } = await ctx.params;

    if (!groupId) return NextResponse.json({ error: 'Missing params' }, { status: 400 });

    try {
      const body = await req.json();
      const userId = (body.userId ?? '').trim();
      if (!userId) return NextResponse.json({ error: 'Missing userId' }, { status: 422 });

      // Ensure group + course consistency
      const group = await prisma.group.findUnique({ where: { id: groupId } });
      if (!group || group.courseId !== courseId)
        return NextResponse.json({ error: 'Group not found for course' }, { status: 404 });

      // Ensure user exists and is enrolled in the course
      const rosterEntry = await prisma.roster.findUnique({
        where: { courseId_userId: { courseId, userId } },
      });
      if (!rosterEntry)
        return NextResponse.json({ error: 'User is not enrolled in course' }, { status: 422 });

      // Create or update group roster entry (skip duplicates)
      await prisma.groupRoster.upsert({
        where: { groupId_userId: { groupId, userId } },
        create: { courseId, groupId, userId },
        update: {},
      });

      await createEnhancedActivityLog(prisma, req, {
        userId: user.id,
        action: 'ADD_GROUP_MEMBER',
        severity: 'INFO',
        category: 'COURSE',
        metadata: { courseId, groupId, userId },
      });

      return NextResponse.json({ success: true }, { status: 201 });
    } catch (err) {
      console.error('[GROUP_MEMBERS_POST_ERROR]', err);
      await createEnhancedActivityLog(prisma, req, {
        userId: user.id,
        action: 'GROUP_MEMBER_ADD_ERROR',
        severity: 'ERROR',
        metadata: { error: err instanceof Error ? err.message : 'unknown error' },
      });
      return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
  },
  { access: 'manage', deniedAction: 'GROUP_MEMBER_ADD_DENIED' },
);

/**
 * Replaces a group's membership with the given set of users in one call, computing
 * the adds and removes. Course staff (faculty or TAs) or a system admin. Every user
 * must be enrolled in the course, or the whole update is rejected.
 * @openapi
 * summary: Set group members in bulk
 * parameters:
 *   - { name: id, in: path, required: true, schema: { type: string } }
 *   - { name: groupId, in: path, required: true, schema: { type: string } }
 * requestBody:
 *   required: true
 *   content:
 *     application/json:
 *       schema:
 *         type: object
 *         required: [members]
 *         properties:
 *           members: { type: array, items: { type: string }, description: The complete desired member set }
 * responses:
 *   200:
 *     description: Membership updated; lists who was added and removed.
 *     content:
 *       application/json:
 *         schema:
 *           type: object
 *           properties:
 *             success: { type: boolean }
 *             added: { type: array, items: { type: string } }
 *             removed: { type: array, items: { type: string } }
 *   401: { description: Not signed in. }
 *   403: { description: Not course staff or a system admin. }
 *   404: { description: Group not found in this course. }
 *   422: { description: "Missing members array, or some users aren't enrolled." }
 *   500: { description: Server error. }
 */
export const PATCH = withCourseAuth(
  async (req, ctx, { user, courseId }) => {
    const { groupId } = await ctx.params;

    try {
      const body = (await req.json()) as { members?: unknown };
      const members = Array.isArray(body?.members) ? (body.members as unknown[]).map(String) : null;
      if (!members) return NextResponse.json({ error: 'Missing members array' }, { status: 422 });

      // Ensure group exists and belongs to course
      const group = await prisma.group.findUnique({ where: { id: groupId } });
      if (!group || group.courseId !== courseId)
        return NextResponse.json({ error: 'Group not found for course' }, { status: 404 });

      // Validate that all member userIds are enrolled in course
      if (members.length > 0) {
        const rosterEntries = await prisma.roster.findMany({
          where: { courseId, userId: { in: members } },
          select: { userId: true },
        });
        const enrolledSet = new Set(rosterEntries.map((r) => r.userId));
        const invalid = members.filter((m) => !enrolledSet.has(m));
        if (invalid.length > 0)
          return NextResponse.json(
            { error: 'Some users are not enrolled in course', invalid },
            { status: 422 },
          );
      }

      // Compute adds/removes
      const existing = await prisma.groupRoster.findMany({
        where: { groupId },
        select: { userId: true },
      });
      const existingSet = new Set(existing.map((e) => e.userId));
      const desiredSet = new Set(members);

      const toAdd = members.filter((m) => !existingSet.has(m));
      const toRemove = existing.map((e) => e.userId).filter((u) => !desiredSet.has(u));

      // Apply changes
      if (toAdd.length > 0) {
        const data = toAdd.map((userId) => ({ groupId, courseId, userId }));
        await prisma.groupRoster.createMany({ data, skipDuplicates: true });
      }

      if (toRemove.length > 0) {
        await prisma.groupRoster.deleteMany({ where: { groupId, userId: { in: toRemove } } });
      }

      await createEnhancedActivityLog(prisma, req, {
        userId: user.id,
        action: 'SET_GROUP_MEMBERS',
        severity: 'INFO',
        category: 'COURSE',
        metadata: { courseId, groupId, added: toAdd, removed: toRemove },
      });

      return NextResponse.json({ success: true, added: toAdd, removed: toRemove });
    } catch (err) {
      console.error('PATCH /api/courses/[id]/groups/[groupId]/members error:', err);
      await createEnhancedActivityLog(prisma, req, {
        userId: user.id,
        action: 'GROUP_MEMBERS_UPDATE_ERROR',
        severity: 'ERROR',
        metadata: { error: err instanceof Error ? err.message : 'unknown error' },
      });
      return NextResponse.json({ error: 'Server error' }, { status: 500 });
    }
  },
  { access: 'manage', deniedAction: 'GROUP_MEMBERS_UPDATE_DENIED' },
);
