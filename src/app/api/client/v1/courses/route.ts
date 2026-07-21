import { NextResponse } from 'next/server';
import { withClientAuth } from '@/lib/api/with-client-auth';
import { getVisibleClientCourses } from '@/lib/client-course-tree';

/**
 * The signed-in user's courses (slim shape for the client), scoped to the token's
 * user. Visibility is per the viewer's role in each course, and never lists a
 * deleted or archived course:
 *   - Admin: every non-archived course (published or not), enrolled or not.
 *   - Faculty/TA: their non-archived courses (published or not) where they are staff.
 *   - Student: their published non-archived courses that are currently within the
 *     course's start/end date range (a submission tool only lists courses you can
 *     submit to now).
 * A user who is staff in one course and a student in another is judged per course.
 * @openapi
 * summary: List my courses (client)
 * responses:
 *   200:
 *     description: The caller's courses.
 *     content:
 *       application/json:
 *         schema:
 *           type: object
 *           properties:
 *             courses: { type: array, items: { type: object } }
 *   401: { description: Missing or invalid token. }
 */
export const GET = withClientAuth(async (_req, _ctx, { user }) => {
  // Shared with the /tree endpoint so the flat list and the nested tree agree on
  // exactly which courses are visible. Archived courses are never listed (frozen /
  // read-only); the web app shows those separately.
  return NextResponse.json({ courses: await getVisibleClientCourses(user) });
});
