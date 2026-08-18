import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';
import { withCourseAuth } from '@/lib/api/with-auth';
import { readJson } from '@/lib/api/request';
import { logError } from '@/lib/api/activity';
import { lockGroupSetIfUsed } from '@/lib/group-set-service';

type RouteCtx = { params: Promise<{ id: string; aid: string; pid: string; groupId: string }> };

const GroupGradeBody = z.object({
  grade: z.number(),
  /**
   * Apply even though some members already carry a different grade. The first request
   * reports them instead of writing, so overwriting somebody's existing grade is always a
   * deliberate second act rather than a side effect.
   */
  overwrite: z.boolean().optional(),
});

/**
 * Grades a whole group on one problem, writing one grade row per member.
 *
 * A group submits once, so grading member by member is the same grade entered N times, and
 * a typo on the fourth entry is invisible. This writes them together and stamps each row
 * with the group and the value applied, so a later change to one member reads as a
 * deliberate adjustment rather than an inconsistency.
 *
 * Course staff (faculty or TAs) or a system admin.
 * @openapi
 * summary: Grade a whole group on a problem
 * parameters:
 *   - { name: id, in: path, required: true, schema: { type: string } }
 *   - { name: aid, in: path, required: true, schema: { type: string } }
 *   - { name: pid, in: path, required: true, schema: { type: string } }
 *   - { name: groupId, in: path, required: true, schema: { type: string } }
 * requestBody:
 *   required: true
 *   content:
 *     application/json:
 *       schema:
 *         type: object
 *         required: [grade]
 *         properties:
 *           grade: { type: number, description: "The grade to give every member (0..maxPoints)." }
 *           overwrite: { type: boolean, description: "Apply even where members already differ." }
 * responses:
 *   200: { description: The grade applied and the members written. }
 *   400: { description: Grade missing or out of range for this problem. }
 *   401: { description: Not signed in. }
 *   403: { description: Caller is not course staff (faculty or TA) or a system admin. }
 *   404: { description: No such problem or group in this assignment. }
 *   409: { description: Some members already differ. Retry with overwrite. }
 *   500: { description: Server error. }
 */
export const POST = withCourseAuth(
  async (req, ctx: RouteCtx, { user, courseId }) => {
    const graderId = user.id;
    const { aid: assignmentId, pid: problemId, groupId } = await ctx.params;

    try {
      const assignmentProblem = await prisma.assignmentProblem.findUnique({
        where: { assignmentId_problemId: { assignmentId, problemId } },
        select: {
          assignment: { select: { courseId: true, groupSetId: true } },
          maxPoints: true,
        },
      });

      if (!assignmentProblem || assignmentProblem.assignment.courseId !== courseId) {
        return NextResponse.json({ error: 'Problem not found' }, { status: 404 });
      }

      const groupSetId = assignmentProblem.assignment.groupSetId;
      if (!groupSetId) {
        return NextResponse.json(
          { error: 'This assignment is not a group assignment' },
          { status: 400 },
        );
      }

      // The group must belong to the set this assignment uses, or a grade could be written
      // for members of an unrelated group in the same course.
      const group = await prisma.studentGroup.findFirst({
        where: { id: groupId, groupSetId },
        select: {
          id: true,
          name: true,
          memberships: { select: { roster: { select: { userId: true } } } },
        },
      });
      if (!group) {
        return NextResponse.json({ error: 'Group not found in this assignment' }, { status: 404 });
      }

      const memberIds = [...new Set(group.memberships.map((m) => m.roster.userId))];
      if (memberIds.length === 0) {
        return NextResponse.json({ error: 'This group has no members' }, { status: 404 });
      }

      const parsed = await readJson(req, GroupGradeBody);
      if (!parsed.ok) return parsed.response;
      const { grade, overwrite } = parsed.data;

      if (Number.isNaN(grade)) {
        return NextResponse.json({ error: 'Grade must be a number' }, { status: 400 });
      }
      if (grade < 0 || grade > assignmentProblem.maxPoints) {
        return NextResponse.json({ error: 'Grade out of range for this problem' }, { status: 400 });
      }

      // Anyone already carrying a different grade. Reported rather than overwritten, so a
      // deliberate individual adjustment is not silently erased by a routine group grade.
      const existing = await prisma.assignmentProblemGrade.findMany({
        where: { assignmentId, problemId, studentId: { in: memberIds } },
        select: {
          studentId: true,
          grade: true,
          student: { select: { firstName: true, lastName: true } },
        },
      });
      const conflicts = existing
        .filter((row) => row.grade !== grade)
        .map((row) => ({
          studentId: row.studentId,
          name:
            `${row.student.firstName ?? ''} ${row.student.lastName ?? ''}`.trim() || 'this student',
          grade: row.grade,
        }));

      if (conflicts.length > 0 && !overwrite) {
        return NextResponse.json(
          {
            error: 'Some members already have a different grade',
            conflicts,
          },
          { status: 409 },
        );
      }

      // One transaction: every member is graded together, or nobody is. A partial write here
      // would leave a group half-graded with no sign of which half.
      await prisma.$transaction(async (tx) => {
        for (const studentId of memberIds) {
          await tx.assignmentProblemGrade.upsert({
            where: { assignmentId_problemId_studentId: { assignmentId, problemId, studentId } },
            create: {
              assignmentId,
              problemId,
              studentId,
              grade,
              gradedManually: true,
              gradeSource: 'MANUAL',
              groupGradeGroupId: group.id,
              groupGradeValue: grade,
            },
            update: {
              grade,
              gradedManually: true,
              gradeSource: 'MANUAL',
              groupGradeGroupId: group.id,
              groupGradeValue: grade,
            },
          });
        }
        // Entering a grade for a group assignment locks its set, same as the single-student
        // route: the membership a grade was based on must stop moving underneath it.
        await lockGroupSetIfUsed(tx, groupSetId);
      });

      await createEnhancedActivityLog(prisma, req, {
        userId: graderId,
        action: 'GROUP_PROBLEM_GRADE_UPDATED',
        severity: 'INFO',
        category: 'GRADE',
        courseId,
        assignmentId,
        problemId,
        metadata: {
          graderId,
          groupId: group.id,
          groupName: group.name,
          grade,
          memberIds,
          // The marks this replaced, so a student disputing a group grade can be answered.
          overwrote: conflicts.map((c) => ({ studentId: c.studentId, from: c.grade, to: grade })),
          overwroteDiffering: conflicts.map((c) => c.studentId),
        },
      });

      return NextResponse.json({ grade, memberIds, applied: memberIds.length });
    } catch (error) {
      console.error('POST group-grade error:', error);
      await logError(req, {
        userId: graderId,
        action: 'GROUP_PROBLEM_GRADE_ERROR',
        category: 'GRADE',
        error,
      });
      return NextResponse.json({ error: 'Failed to save group grade' }, { status: 500 });
    }
  },
  {
    access: 'manage',
    deniedAction: 'GROUP_PROBLEM_GRADE_DENIED',
    deniedCategory: 'GRADE',
    // An archived course is read-only, and this writes a grade for every member of the group.
    blockWhenArchived: true,
  },
);
