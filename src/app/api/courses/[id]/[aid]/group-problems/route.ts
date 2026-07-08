import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { auth } from '@/lib/auth';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';
import { canAccessCourse, canManageCourse } from '@/lib/permissions';

/**
 * Returns each course group alongside the problem ids mapped to it for this
 * assignment (the group→problem assignment matrix). Any enrolled member of the
 * course (any role) or a system admin.
 * @openapi
 * summary: Get group→problem mappings for an assignment
 * parameters:
 *   - { name: id, in: path, required: true, schema: { type: string } }
 *   - { name: aid, in: path, required: true, schema: { type: string } }
 * responses:
 *   200:
 *     description: Groups, each with its mapped problemIds.
 *     content:
 *       application/json:
 *         schema:
 *           type: object
 *           properties:
 *             success: { type: boolean }
 *             groups: { type: array, items: { type: object } }
 *   403: { description: Not an enrolled member of the course and not a system admin. }
 *   500: { description: Server error. }
 */
export async function GET(_: Request, { params }: { params: Promise<{ id: string; aid: string }> }) {
  const { id: courseId, aid: assignmentId } = await params;

  try {
    const session = await auth();
    const user = session?.user;
    if (!user || !(await canAccessCourse(user, courseId))) {
      await createEnhancedActivityLog(prisma, _ as Request, {
        userId: session?.user?.id ?? null,
        action: 'GROUP_PROBLEMS_ACCESS_DENIED',
        severity: 'SECURITY',
        metadata: {},
      });
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    // Fetch the course's groups and this assignment's group→problem mappings.
    // Independent reads, so run them concurrently.
    const [groups, mappings] = await Promise.all([
      prisma.group.findMany({ where: { courseId }, select: { id: true, name: true } }),
      prisma.groupAssignmentProblem.findMany({ where: { assignmentId } }),
    ]);

    const mapByGroup: Record<string, string[]> = {};
    for (const m of mappings) {
      if (!mapByGroup[m.groupId]) mapByGroup[m.groupId] = [];
      mapByGroup[m.groupId].push(m.problemId);
    }

    const result = groups.map((g) => ({ id: g.id, name: g.name, problemIds: mapByGroup[g.id] ?? [] }));

    // Activity log: user viewed group -> problem mappings for an assignment
    try {
      await createEnhancedActivityLog(prisma, _ as Request, {
        userId: user.id,
        action: 'VIEW_GROUP_PROBLEMS',
        severity: 'INFO',
        category: 'ASSIGNMENT',
        courseId,
        assignmentId,
        metadata: { courseId, assignmentId },
      });
    } catch (logErr) {
      console.error('[group-problems] activityLog.create failed:', logErr);
    }

    return NextResponse.json({ success: true, groups: result });
  } catch (err) {
    console.error('Failed to fetch group problems:', err);
    return NextResponse.json({ error: 'Failed to fetch group problems' }, { status: 500 });
  }
}

/**
 * Removes group→problem mappings for an assignment. Course staff (faculty or TAs) or
 * a system admin. A `groupId` is required — pass a specific group id, or "ALL" to clear the given
 * problems from every group. The problems themselves stay on the assignment.
 * @openapi
 * summary: Remove group→problem mappings
 * parameters:
 *   - { name: id, in: path, required: true, schema: { type: string } }
 *   - { name: aid, in: path, required: true, schema: { type: string } }
 * requestBody:
 *   required: true
 *   content:
 *     application/json:
 *       schema:
 *         type: object
 *         required: [problemIds, groupId]
 *         properties:
 *           problemIds: { type: array, items: { type: string } }
 *           groupId: { type: string, description: 'A group id, or "ALL"' }
 * responses:
 *   200: { description: Mappings removed. }
 *   400: { description: "Empty body, no problemIds, invalid group, or missing groupId." }
 *   403: { description: Caller is not course staff (faculty or TA) or a system admin. }
 *   500: { description: Server error. }
 */
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string; aid: string }> }) {
  const { id: courseId, aid: assignmentId } = await params;

  try {
    const session = await auth();
    const user = session?.user;
    if (!user || !(await canManageCourse(user, courseId))) {
      await createEnhancedActivityLog(prisma, req, {
        userId: session?.user?.id ?? null,
        action: 'GROUP_PROBLEMS_REMOVE_DENIED',
        severity: 'SECURITY',
        metadata: {},
      });
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    let body;
    try {
      const text = await req.text();
      if (!text || text.trim() === '') {
        return NextResponse.json({ error: 'Empty request body' }, { status: 400 });
      }
      body = JSON.parse(text);
    } catch (parseErr) {
      console.error('Invalid JSON in DELETE /group-problems:', parseErr);
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const problemIds: string[] = Array.isArray(body.problemIds) ? body.problemIds : [];
    const groupId: string | undefined = typeof body.groupId === 'string' ? body.groupId : undefined;

    if (problemIds.length === 0) {
      return NextResponse.json({ error: 'No problemIds provided' }, { status: 400 });
    }

    // If a specific group is requested, ensure it belongs to the course
    if (groupId && groupId !== 'ALL') {
      const group = await prisma.group.findUnique({ where: { id: groupId } });
      if (!group || group.courseId !== courseId) {
        return NextResponse.json({ error: 'Invalid group' }, { status: 400 });
      }
    }

    if (groupId === 'ALL') {
      // Remove all mappings for these problems in this assignment
      await prisma.groupAssignmentProblem.deleteMany({ where: { assignmentId, problemId: { in: problemIds } } });
    } else if (groupId) {
      // Remove mappings for the specific group
      await prisma.groupAssignmentProblem.deleteMany({ where: { assignmentId, problemId: { in: problemIds }, groupId } });
    } else {
      // No group specified - ambiguous
      return NextResponse.json({ error: 'groupId is required for DELETE' }, { status: 400 });
    }

    // Activity log: group -> problem mappings were removed
    try {
      await createEnhancedActivityLog(prisma, req as Request, {
        userId: user.id,
        action: 'REMOVE_GROUP_PROBLEMS',
        severity: 'INFO',
        category: 'ASSIGNMENT',
        courseId,
        assignmentId,
        metadata: { courseId, assignmentId, groupId: groupId ?? 'ALL', problemIds },
      });
    } catch (logErr) {
      console.error('[group-problems] activityLog.create failed:', logErr);
      // do not fail the request due to logging
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Failed to delete group problems:', err);
    await createEnhancedActivityLog(prisma, req, {
      userId: null,
      action: 'GROUP_PROBLEMS_REMOVE_ERROR',
      severity: 'ERROR',
      metadata: { error: err instanceof Error ? err.message : 'unknown error' },
    });
    return NextResponse.json({ error: 'Failed to delete group problems' }, { status: 500 });
  }
}
