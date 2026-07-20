import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withCourseAuth } from '@/lib/api/with-auth';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';
import { logError } from '@/lib/api/activity';
import { readJson } from '@/lib/api/request';
import { resolveCourseTimezone } from '@/lib/course-timezone';
import { toDateTimeInTimezone, toEndOfDayInTimezone } from '@/lib/date-utils';
import { resolveUnlockAt } from '@/lib/assignment-late-window';
import { AssignmentCreateApiSchema } from '@/schemas/assignment';

/**
 * Lists a course's published assignments with each one's total and max grade
 * (summed across its problems). Course faculty or a system admin (TAs excluded).
 * @openapi
 * summary: List a course's published assignments
 * parameters:
 *   - { name: id, in: path, required: true, schema: { type: string } }
 * responses:
 *   200:
 *     description: Published assignments with totalGrade and maxGrade.
 *     content:
 *       application/json:
 *         schema: { type: array, items: { type: object } }
 *   401: { description: Not signed in. }
 *   403: { description: Caller is not course faculty or a system admin (TAs excluded). }
 *   404: { description: Course not found. }
 *   500: { description: Server error. }
 */
export const GET = withCourseAuth(
  async (_req, _ctx, { courseId }) => {
    try {
      const course = await prisma.course.findUnique({
        where: { id: courseId },
        select: { id: true },
      });

      if (!course) {
        return NextResponse.json({ error: 'Course not found' }, { status: 404 });
      }

      // Pull each assignment's problems too, to derive total/max grade below.
      const assignments = await prisma.assignment.findMany({
        where: {
          courseId: courseId,
          isPublished: true,
        },
        select: {
          id: true,
          title: true,
          dueDate: true,
          description: true,
          problems: {
            select: {
              problemId: true,
              maxPoints: true,
              grades: {
                select: { grade: true },
                take: 1,
              },
            },
          },
        },
        orderBy: {
          dueDate: 'asc',
        },
      });

      const result = assignments.map(({ problems, ...assignment }) => {
        const maxGrade = problems.reduce((sum, p) => sum + p.maxPoints, 0);
        const totalGrade = problems.reduce((sum, p) => sum + (p.grades[0]?.grade ?? 0), 0);
        return { ...assignment, totalGrade, maxGrade };
      });

      return NextResponse.json(result);
    } catch (error) {
      console.error('API GET ASSIGNMENTS error:', error);
      return NextResponse.json({ error: 'Failed to fetch assignments.' }, { status: 500 });
    }
  },
  // Course staff (FACULTY + TA), matching who can create/edit assignments below.
  { access: 'manage', deniedAction: 'COURSE_ASSIGNMENTS_ACCESS_DENIED' },
);

/**
 * Creates an assignment in the course. Course staff (faculty or TAs) or a system
 * admin. The due date is interpreted as end-of-day in the **course's** timezone. The
 * late cutoff is optional when late submissions are on (blank means no deadline), must
 * be omitted when late is off, and must fall on or after the due date when set.
 * @openapi
 * summary: Create a course assignment
 * parameters:
 *   - { name: id, in: path, required: true, schema: { type: string } }
 * requestBody:
 *   required: true
 *   content:
 *     application/json:
 *       schema:
 *         type: object
 *         required: [title]
 *         properties:
 *           title: { type: string }
 *           description: { type: string }
 *           dueDate: { type: string, description: Interpreted as end-of-day in the course's timezone }
 *           unlockAt: { type: string, description: Available-from date; must be on or before the due date }
 *           allowLateSubmissions: { type: boolean }
 *           lateCutoff: { type: string, description: Required when allowLateSubmissions is true }
 *           isPublished: { type: boolean }
 *           assignedToEveryone: { type: boolean, description: "When false, only the assignees below are assigned" }
 *           groupSetId: { type: string, nullable: true, description: "Set for a group assignment (the group set it runs in)" }
 *           assignees:
 *             type: array
 *             description: "Audience when assignedToEveryone is false; each item is one student (userId) or group (groupId)"
 *             items: { type: object, properties: { userId: { type: string }, groupId: { type: string } } }
 * responses:
 *   201: { description: The created assignment. }
 *   400: { description: "Missing fields, or an inconsistent late-submission window." }
 *   401: { description: Not signed in. }
 *   403: { description: Not course staff or a system admin. }
 *   500: { description: Server error. }
 */
export const POST = withCourseAuth(
  async (req, _ctx, { user, courseId }) => {
    try {
      const parsed = await readJson(req, AssignmentCreateApiSchema);
      if (!parsed.ok) return parsed.response;
      const data = parsed.data;

      // Deadlines are anchored to the COURSE's timezone (not the actor's), so a
      // due date is one fixed instant for every student regardless of who saved it.
      const courseTimezone = await resolveCourseTimezone(courseId);
      const allowLateSubmissions =
        typeof data.allowLateSubmissions === 'boolean' ? data.allowLateSubmissions : false;

      if (!allowLateSubmissions && data.lateCutoff) {
        return NextResponse.json(
          { error: 'Late cutoff provided but late submissions are disabled.' },
          { status: 400 },
        );
      }
      // A cutoff is optional when late submissions are enabled: no cutoff means late
      // submissions are accepted with no deadline.

      const dueDate = toEndOfDayInTimezone(data.dueDate, courseTimezone);
      const lateCutoffDate =
        allowLateSubmissions && data.lateCutoff
          ? toDateTimeInTimezone(data.lateCutoff, courseTimezone)
          : null;

      if (lateCutoffDate && lateCutoffDate < dueDate) {
        return NextResponse.json(
          { error: 'Late cutoff must be on or after the due date.' },
          { status: 400 },
        );
      }

      const unlockState = resolveUnlockAt({
        incoming: data.unlockAt,
        existing: null,
        dueDate,
        timezone: courseTimezone,
      });
      if (!unlockState.ok) {
        return NextResponse.json({ error: unlockState.message }, { status: 400 });
      }

      // Individual vs group + audience. groupSetId set => group assignment (its assignees
      // are groups in that set); no groupSetId => individual (assignees are enrolled
      // students). "Assigned to everyone" carries no assignee rows.
      const groupSetId = data.groupSetId ?? null;
      if (groupSetId) {
        const set = await prisma.groupSet.findFirst({
          where: { id: groupSetId, courseId },
          select: { id: true },
        });
        if (!set) {
          return NextResponse.json({ error: 'Group set not found in this course.' }, { status: 400 });
        }
      }

      const assignedToEveryone = data.assignedToEveryone ?? true;
      const assigneeInputs = assignedToEveryone ? [] : (data.assignees ?? []);
      const assigneeRows: Array<{ targetType: 'STUDENT' | 'GROUP'; userId?: string; groupId?: string }> =
        [];

      if (!assignedToEveryone) {
        if (assigneeInputs.length === 0) {
          return NextResponse.json(
            { error: 'Assign to at least one student or group, or assign to everyone.' },
            { status: 400 },
          );
        }
        if (groupSetId) {
          const groupIds = assigneeInputs.map((a) => a.groupId).filter((v): v is string => !!v);
          if (groupIds.length !== assigneeInputs.length) {
            return NextResponse.json(
              { error: 'A group assignment can only be assigned to groups.' },
              { status: 400 },
            );
          }
          const found = await prisma.studentGroup.findMany({
            where: { id: { in: groupIds }, groupSetId },
            select: { id: true },
          });
          const ok = new Set(found.map((g) => g.id));
          if (groupIds.some((id) => !ok.has(id))) {
            return NextResponse.json(
              { error: "A group is not in this assignment's group set." },
              { status: 400 },
            );
          }
          for (const id of new Set(groupIds)) assigneeRows.push({ targetType: 'GROUP', groupId: id });
        } else {
          const userIds = assigneeInputs.map((a) => a.userId).filter((v): v is string => !!v);
          if (userIds.length !== assigneeInputs.length) {
            return NextResponse.json(
              { error: 'An individual assignment can only be assigned to students.' },
              { status: 400 },
            );
          }
          const found = await prisma.roster.findMany({
            where: { courseId, userId: { in: userIds }, role: 'STUDENT' },
            select: { userId: true },
          });
          const ok = new Set(found.map((r) => r.userId));
          if (userIds.some((id) => !ok.has(id))) {
            return NextResponse.json(
              { error: 'A target is not a student enrolled in this course.' },
              { status: 400 },
            );
          }
          for (const id of new Set(userIds)) assigneeRows.push({ targetType: 'STUDENT', userId: id });
        }
      }

      const created = await prisma.$transaction(async (tx) => {
        const assignment = await tx.assignment.create({
          data: {
            title: data.title,
            description: data.description,
            dueDate,
            unlockAt: unlockState.unlockAt,
            assignedToEveryone,
            allowLateSubmissions,
            lateCutoff: lateCutoffDate,
            isPublished: data.isPublished || false,
            groupSetId,
            courseId,
          },
        });
        if (assigneeRows.length > 0) {
          await tx.assignmentAssignee.createMany({
            data: assigneeRows.map((r) => ({ ...r, assignmentId: assignment.id })),
          });
        }
        return assignment;
      });

      await createEnhancedActivityLog(prisma, req, {
        userId: user.id,
        action: 'CREATE_ASSIGNMENT',
        severity: 'INFO',
        category: 'ASSIGNMENT',
        courseId,
        assignmentId: created.id,
        metadata: {
          userId: user.id,
          courseId,
          assignmentId: created.id,
          title: created.title,
          description: created.description ? created.description : '',
          isPublished: created.isPublished,
          dueDate: created.dueDate.toISOString(),
          unlockAt: created.unlockAt ? created.unlockAt.toISOString() : null,
          allowLateSubmissions: created.allowLateSubmissions,
          lateCutoff: created.lateCutoff ? created.lateCutoff.toISOString() : null,
          groupSetId: created.groupSetId,
          assignedToEveryone: created.assignedToEveryone,
          assigneeCount: assigneeRows.length,
        },
      });

      return NextResponse.json(created, { status: 201 });
    } catch (error) {
      console.error('Assignment creation failed:', error);
      await logError(req, {
        userId: user.id,
        action: 'ASSIGNMENT_CREATE_ERROR',
        category: 'ASSIGNMENT',
        courseId,
        error,
      });
      return NextResponse.json({ error: 'Failed to create assignment' }, { status: 500 });
    }
  },
  { access: 'manage', deniedAction: 'ASSIGNMENT_CREATE_DENIED', blockWhenArchived: true },
);
