import { NextResponse } from 'next/server';
import { logThrottledView } from '@/lib/api/activity';
import { withCourseAuth } from '@/lib/api/with-auth';
import { getCourseStatistics } from '@/lib/course-statistics-service';

// The tab refetches on focus/interval; record one view per user/course/window so a
// background refetch doesn't flood the audit log (mirrors the assignment statistics route).

/**
 * Aggregate analytics for a whole course: the grade distribution, how the assignments compare,
 * how the class does on each kind of problem, what is waiting on a grader, and when work
 * arrives. Course staff (faculty or TAs) or a system admin only.
 *
 * The figures describe students who are enrolled and whose account is active; anybody left
 * out is reported as a count with a reason. These are aggregate student-performance figures,
 * a FERPA-relevant read, so the access is audited (throttled).
 * @openapi
 * summary: Get a course's analytics
 * parameters:
 *   - { name: id, in: path, required: true, schema: { type: string } }
 * responses:
 *   200:
 *     description: Course-wide distribution, per-assignment comparison, problem-type performance, grading workload and submission timing.
 *     content:
 *       application/json:
 *         schema:
 *           type: object
 *           properties:
 *             courseTitle: { type: string }
 *             timezone: { type: string }
 *             studentCount: { type: integer }
 *             exclusions: { type: array, items: { type: object } }
 *             distribution: { type: object }
 *             distributionGradedOnly: { type: object }
 *             assignments: { type: array, items: { type: object } }
 *             problemTypes: { type: array, items: { type: object } }
 *             workload: { type: array, items: { type: object } }
 *             atRisk: { type: object }
 *             timeline: { type: array, items: { type: object } }
 *             heatmap: { type: object }
 *   401: { description: Not signed in. }
 *   403: { description: Not course staff (faculty or TA) or a system admin. }
 *   404: { description: Course not found. }
 *   500: { description: Server error. }
 */
export const GET = withCourseAuth(
  async (req, _ctx, { user, courseId }) => {
    try {
      const stats = await getCourseStatistics(courseId);
      if (!stats) {
        return NextResponse.json({ error: 'Course not found' }, { status: 404 });
      }

      // A sensitive read, recorded once per window; see logThrottledView for why it is
      // throttled rather than written per request. The metadata is deliberately the same
      // shape as the assignment tab's, so a study year can compare the two.
      await logThrottledView(req, {
        userId: user.id,
        action: 'COURSE_STATISTICS_VIEWED',
        category: 'GRADE',
        courseId,
        metadata: { studentCount: stats.studentCount, assignments: stats.assignments.length },
      });

      return NextResponse.json(stats);
    } catch (error) {
      console.error('GET /api/courses/[id]/statistics error:', error);
      return NextResponse.json({ error: 'Failed to fetch statistics' }, { status: 500 });
    }
  },
  {
    access: 'manage',
    deniedAction: 'COURSE_STATISTICS_ACCESS_DENIED',
    deniedCategory: 'GRADE',
  },
);
