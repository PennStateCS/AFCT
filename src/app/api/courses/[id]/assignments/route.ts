import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withCourseAuth } from '@/lib/api/with-auth';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';
import { logError } from '@/lib/api/activity';
import { readJson } from '@/lib/api/request';
import { resolveCourseTimezone } from '@/lib/course-timezone';
import { toDateTimeInTimezone, toEndOfDayInTimezone } from '@/lib/date-utils';
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
 * admin. The due date is interpreted as end-of-day in the **course's** timezone. Late
 * submissions and their cutoff must agree: a cutoff is required when late is on,
 * forbidden when off, and must fall on or after the due date.
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
 *           allowLateSubmissions: { type: boolean }
 *           lateCutoff: { type: string, description: Required when allowLateSubmissions is true }
 *           isPublished: { type: boolean }
 *           isGroup: { type: boolean }
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
      if (allowLateSubmissions && !data.lateCutoff) {
        return NextResponse.json(
          { error: 'Late submission cutoff is required when late submissions are enabled.' },
          { status: 400 },
        );
      }

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

      const created = await prisma.assignment.create({
        data: {
          title: data.title,
          description: data.description,
          dueDate,
          allowLateSubmissions,
          lateCutoff: lateCutoffDate,
          isPublished: data.isPublished || false,
          isGroup: !!data.isGroup,
          courseId,
        },
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
          isGroup: created.isGroup,
          dueDate: created.dueDate.toISOString(),
          allowLateSubmissions: created.allowLateSubmissions,
          lateCutoff: created.lateCutoff ? created.lateCutoff.toISOString() : null,
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
