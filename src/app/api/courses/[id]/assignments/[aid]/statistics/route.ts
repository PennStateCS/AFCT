import { NextResponse } from 'next/server';
import { logThrottledView } from '@/lib/api/activity';
import { withCourseAuth } from '@/lib/api/with-auth';
import { getAssignmentStatistics } from '@/lib/assignment-statistics-service';

// The tab refetches on focus/interval; record one view per user/assignment/window so a
// background refetch doesn't flood the audit log (mirrors the grades matrix route).

/**
 * Aggregate analytics for one assignment: score histogram, per-problem box plots, and
 * submission-status breakdown, measured in students (individual) or groups (group
 * assignment). Course staff (faculty or TAs) or a system admin only. These are aggregate
 * student-performance figures, a FERPA-relevant read, so the access is audited (throttled).
 * @openapi
 * summary: Get an assignment's analytics
 * parameters:
 *   - { name: id, in: path, required: true, schema: { type: string } }
 *   - { name: aid, in: path, required: true, schema: { type: string } }
 * responses:
 *   200:
 *     description: Histogram, box plots, and status breakdown for the assignment.
 *     content:
 *       application/json:
 *         schema:
 *           type: object
 *           properties:
 *             unit: { type: string, enum: [student, group] }
 *             participantCount: { type: integer }
 *             exceptionCount: { type: integer }
 *             histogram: { type: object }
 *             problems: { type: array, items: { type: object } }
 *             assignmentTitle: { type: string }
 *             baseDueDate: { type: string }
 *             timezone: { type: string }
 *   401: { description: Not signed in. }
 *   403: { description: Not course staff (faculty or TA) or a system admin. }
 *   404: { description: Assignment not found in this course. }
 *   500: { description: Server error. }
 */
export const GET = withCourseAuth(
  async (req, ctx, { user, courseId }) => {
    try {
      const { aid: assignmentId } = await ctx.params;
      if (!assignmentId) {
        return NextResponse.json({ error: 'Assignment not found' }, { status: 404 });
      }
      const stats = await getAssignmentStatistics(courseId, assignmentId);
      if (!stats) {
        return NextResponse.json({ error: 'Assignment not found' }, { status: 404 });
      }

      // A sensitive read, recorded once per window; see logThrottledView for why it is
      // throttled rather than written per request.
      await logThrottledView(req, {
        userId: user.id,
        action: 'ASSIGNMENT_STATISTICS_VIEWED',
        category: 'GRADE',
        courseId,
        assignmentId,
        metadata: { unit: stats.unit, participantCount: stats.participantCount },
      });

      return NextResponse.json(stats);
    } catch (error) {
      console.error('GET /api/courses/[id]/assignments/[aid]/statistics error:', error);
      return NextResponse.json({ error: 'Failed to fetch statistics' }, { status: 500 });
    }
  },
  {
    access: 'manage',
    deniedAction: 'ASSIGNMENT_STATISTICS_ACCESS_DENIED',
    deniedCategory: 'GRADE',
  },
);
