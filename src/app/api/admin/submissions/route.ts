import { NextResponse } from 'next/server';
import { apiError } from '@/lib/api/http';
import { logError } from '@/lib/api/activity';
import { withAdminAuth } from '@/lib/api/with-auth';
import { readJson } from '@/lib/api/request';
import { AutograderSubmissionsQuerySchema } from '@/schemas/submission';
import { getAutograderSubmissionsPage } from '@/lib/autograder-submissions';

/**
 * One page of autograded submissions for the admin Autograder page: student, course,
 * assignment/problem titles, queue status, and the recorded grade (joined from
 * AssignmentProblemGrade). Search, filters, sort and pagination all run in the database.
 * System administrators only.
 *
 * A POST with a JSON body rather than the GET + query string the other paginated routes
 * use, because the scope can carry hundreds of problem ids. Empty scope lists mean "no
 * constraint", so the common case (everything) sends nothing at all.
 *
 * Problems with the autograder switched off are left out: this feeds the Autograder page,
 * and a submission the autograder never touches has no queue state and no per-attempt score
 * to show there. Those submissions still appear on the course's own submissions tab.
 *
 * Deliberately does not log the read. It never has, and paginating turns one read into one
 * log per page the admin flips through, which would distort ActivityLog as research data.
 * @openapi
 * summary: List autograded submissions (admin, paginated)
 * requestBody:
 *   required: true
 *   content:
 *     application/json:
 *       schema:
 *         type: object
 *         properties:
 *           courseIds: { type: array, items: { type: string }, description: "Empty means every course" }
 *           assignmentIds: { type: array, items: { type: string }, description: "Empty means every assignment" }
 *           problemIds: { type: array, items: { type: string }, description: "Empty means every problem" }
 *           q: { type: string, description: "Match on student, course, assignment, problem, or file name" }
 *           field: { type: string, enum: [all, student, course, assignment, problem, file], default: all }
 *           timing: { type: array, items: { type: string, enum: [ontime, late] } }
 *           status: { type: array, items: { type: string, enum: [pending, processing, failed, correct, incorrect] } }
 *           page: { type: integer, minimum: 1, default: 1 }
 *           pageSize: { type: integer, minimum: 1, maximum: 100, default: 10 }
 *           sortBy: { type: string, enum: [submittedAt, student, course, assignment, problem, file, due, status] }
 *           sortDir: { type: string, enum: [asc, desc], default: desc }
 * responses:
 *   200:
 *     description: One page of autograded submissions.
 *     content:
 *       application/json:
 *         schema:
 *           type: object
 *           properties:
 *             rows: { type: array, items: { type: object } }
 *             total: { type: integer }
 *             page: { type: integer }
 *             pageSize: { type: integer }
 *             totalPages: { type: integer }
 *   400: { description: Malformed body. }
 *   401: { description: Not signed in. }
 *   403: { description: Caller is not a system administrator. }
 *   500: { description: Server error. }
 */
export const POST = withAdminAuth(
  async (req, _ctx, { user }) => {
    const parsed = await readJson(req, AutograderSubmissionsQuerySchema);
    if (!parsed.ok) return parsed.response;
    const { page, pageSize, ...filters } = parsed.data;

    try {
      const { rows, total } = await getAutograderSubmissionsPage({
        ...filters,
        skip: (page - 1) * pageSize,
        take: pageSize,
      });

      return NextResponse.json({
        rows,
        total,
        page,
        pageSize,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
      });
    } catch (error) {
      console.error('Error fetching submissions:', error);
      await logError(req, {
        userId: user.id,
        action: 'ADMIN_SUBMISSIONS_ERROR',
        category: 'SUBMISSION',
        error,
      });
      return apiError(500, 'Failed to fetch submissions');
    }
  },
  { deniedAction: 'ADMIN_SUBMISSIONS_ACCESS_DENIED' },
);
