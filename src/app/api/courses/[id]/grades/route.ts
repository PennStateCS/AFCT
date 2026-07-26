import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';
import { withCourseAuth } from '@/lib/api/with-auth';
import {
  getCourseGradeMatrix,
  getCourseGradeStructure,
  getCourseGradeValues,
} from '@/lib/course-grades';

// The grades tab refetches on focus and on an interval; only record a view once per
// user / course / window so a background refetch doesn't flood the audit log.
const GRADES_VIEW_THROTTLE_MS = 10 * 60 * 1000;

/**
 * Returns the full gradebook matrix for a course: students x assignments with each cell
 * holding the student's summed assignment grade (problem grades collapsed into one
 * total). Course staff (faculty or TAs) or a system admin. Reading the whole gradebook
 * is a FERPA-relevant access, so it's recorded (throttled) in the audit log.
 * @openapi
 * summary: Get the course grade matrix
 * parameters:
 *   - { name: id, in: path, required: true, schema: { type: string } }
 *   - name: part
 *     in: query
 *     required: false
 *     description: "`structure` returns students + assignments; `values` returns just the grades map; omitted returns the full matrix."
 *     schema: { type: string, enum: [structure, values] }
 * responses:
 *   200:
 *     description: Students, assignments, and a nested grades map (grades[studentId][assignmentId]).
 *     content:
 *       application/json:
 *         schema:
 *           type: object
 *           properties:
 *             students: { type: array, items: { type: object } }
 *             assignments: { type: array, items: { type: object } }
 *             grades: { type: object }
 *   401: { description: Not signed in. }
 *   403: { description: Not course staff (faculty or TAs) or a system admin. }
 *   500: { description: Server error. }
 */
export const GET = withCourseAuth(
  async (req, _ctx, { user, courseId }) => {
    try {
      // The gradebook loads in two parts so the table can paint its columns while the
      // grade cells are still loading: `?part=structure` returns students + assignments
      // (fast); `?part=values` returns just the grades (the slower aggregation). No part
      // returns the full matrix (used by the LMS export path). The grade *values* are
      // the FERPA-relevant read, so that's what the throttled audit records.
      const part = new URL(req.url).searchParams.get('part');

      if (part === 'structure') {
        return NextResponse.json(await getCourseGradeStructure(courseId));
      }

      const payload = part === 'values' ? await getCourseGradeValues(courseId) : await getCourseGradeMatrix(courseId);

      // Best-effort, throttled read audit — never block the response on it.
      try {
        const recent = await prisma.activityLog.findFirst({
          where: {
            userId: user.id,
            courseId,
            action: 'COURSE_GRADES_VIEWED',
            timestamp: { gte: new Date(Date.now() - GRADES_VIEW_THROTTLE_MS) },
          },
          select: { id: true },
        });
        if (!recent) {
          await createEnhancedActivityLog(prisma, req, {
            userId: user.id,
            action: 'COURSE_GRADES_VIEWED',
            severity: 'INFO',
            category: 'GRADE',
            courseId,
            metadata: { studentCount: Object.keys(payload.grades).length },
          });
        }
      } catch (logErr) {
        console.error('Failed to log grades view:', logErr);
      }

      return NextResponse.json(payload);
    } catch (error) {
      console.error('GET /api/courses/[id]/grades error:', error);
      const detail = error instanceof Error ? error.message : String(error);
      return NextResponse.json(
        {
          error: 'Failed to fetch grades',
          detail: process.env.NODE_ENV === 'development' ? detail : undefined,
        },
        { status: 500 },
      );
    }
  },
  { access: 'manage', deniedAction: 'COURSE_GRADES_ACCESS_DENIED', deniedCategory: 'GRADE' },
);
