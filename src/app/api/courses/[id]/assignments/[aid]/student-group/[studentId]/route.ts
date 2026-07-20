import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withCourseAuth } from '@/lib/api/with-auth';
import { logError } from '@/lib/api/activity';
import { resolveStudentSubmissionGroupId } from '@/lib/assignment-groups';
import { effectiveDeadline } from '@/lib/effective-deadline';

type Ctx = { params: Promise<{ id: string; aid: string; studentId: string }> };

/**
 * Whether a student submits this assignment individually or as a group, the group's name +
 * groupmates (for a group), and the student's EFFECTIVE schedule (their own or their group's
 * date override resolved against the base). Drives the per-student due/late line and the
 * Individual / Group indicator on the staff Submissions view. Course staff or a system admin.
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
        select: {
          id: true,
          unlockAt: true,
          dueDate: true,
          lateCutoff: true,
          allowLateSubmissions: true,
          // This student's applicable date overrides: their own, and their group's.
          overrides: {
            where: {
              OR: [
                { userId: studentId },
                { studentGroup: { memberships: { some: { userId: studentId } } } },
              ],
            },
            select: {
              targetType: true,
              userId: true,
              groupId: true,
              unlockAt: true,
              dueDate: true,
              lateCutoff: true,
              allowLateSubmissions: true,
            },
          },
        },
      });
      if (!assignment) {
        return NextResponse.json({ error: 'Assignment not found' }, { status: 404 });
      }

      const groupId = await resolveStudentSubmissionGroupId(aid, studentId);

      // The student's effective schedule = their own or their group's override resolved
      // against the base. Group ids come from the submission group plus any group the
      // override rows target (the query already limits those to this student's groups).
      const studentGroupIds = [
        ...new Set(
          [
            groupId,
            ...assignment.overrides
              .filter((o) => o.targetType === 'GROUP' && o.groupId)
              .map((o) => o.groupId),
          ].filter((v): v is string => !!v),
        ),
      ];
      const eff = effectiveDeadline(
        {
          unlockAt: assignment.unlockAt,
          dueDate: assignment.dueDate,
          lateCutoff: assignment.lateCutoff,
          allowLateSubmissions: assignment.allowLateSubmissions,
        },
        assignment.overrides,
        studentId,
        studentGroupIds,
      );
      const effective = {
        unlockAt: eff.unlockAt ? eff.unlockAt.toISOString() : null,
        dueDate: eff.dueDate.toISOString(),
        lateCutoff: eff.lateCutoff ? eff.lateCutoff.toISOString() : null,
        allowLateSubmissions: eff.allowLateSubmissions,
        source: eff.source,
      };

      if (!groupId) {
        return NextResponse.json({ isGroup: false, group: null, members: [], effective });
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
        effective,
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
