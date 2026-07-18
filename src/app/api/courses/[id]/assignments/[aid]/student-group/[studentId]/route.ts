import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withCourseAuth } from '@/lib/api/with-auth';
import { logError } from '@/lib/api/activity';
import { resolveStudentSubmissionGroupId } from '@/lib/assignment-groups';

type Ctx = { params: Promise<{ id: string; aid: string; studentId: string }> };

/**
 * Whether a student submits this assignment individually or as a group, and (for a group)
 * the group's name plus the student's groupmates. Drives the "Individual / Group" indicator
 * on the staff Submissions view. Course staff (faculty or TAs) or a system admin.
 * @openapi
 * summary: Get a student's group membership for an assignment
 * parameters:
 *   - { name: id, in: path, required: true, schema: { type: string } }
 *   - { name: aid, in: path, required: true, schema: { type: string } }
 *   - { name: studentId, in: path, required: true, schema: { type: string } }
 * responses:
 *   200: { description: The student's individual/group status for the assignment. }
 *   401: { description: Not signed in. }
 *   403: { description: Not course staff or a system admin. }
 *   404: { description: Assignment not found in this course. }
 *   500: { description: Server error. }
 */
export const GET = withCourseAuth(
  async (req, ctx: Ctx, { user, courseId }) => {
    const { aid, studentId } = await ctx.params;
    try {
      const assignment = await prisma.assignment.findFirst({
        where: { id: aid, courseId },
        select: { id: true },
      });
      if (!assignment) {
        return NextResponse.json({ error: 'Assignment not found' }, { status: 404 });
      }

      const groupId = await resolveStudentSubmissionGroupId(aid, studentId);
      if (!groupId) {
        return NextResponse.json({ isGroup: false, group: null, members: [] });
      }

      const group = await prisma.studentGroup.findUnique({
        where: { id: groupId },
        select: {
          id: true,
          name: true,
          memberships: {
            select: {
              roster: {
                select: {
                  user: { select: { id: true, firstName: true, lastName: true } },
                },
              },
            },
          },
        },
      });
      // The student's groupmates: everyone in the group except the selected student.
      const members = (group?.memberships ?? [])
        .map((m) => m.roster.user)
        .filter((u) => u.id !== studentId);

      return NextResponse.json({
        isGroup: true,
        group: group ? { id: group.id, name: group.name } : null,
        members,
      });
    } catch (error) {
      console.error('GET student-group error:', error);
      await logError(req, {
        userId: user.id,
        action: 'ASSIGNMENT_STUDENT_GROUP_ERROR',
        category: 'ASSIGNMENT',
        courseId,
        assignmentId: aid,
        error,
      });
      return NextResponse.json({ error: 'Failed to load group info' }, { status: 500 });
    }
  },
  { access: 'manage', deniedAction: 'ASSIGNMENT_STUDENT_GROUP_VIEW_DENIED' },
);
