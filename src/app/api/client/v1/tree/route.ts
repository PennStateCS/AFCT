import { NextResponse } from 'next/server';
import { withClientAuth } from '@/lib/api/with-client-auth';
import { buildClientCourseTree } from '@/lib/client-course-tree';

/**
 * The caller's entire course tree in one call: every visible course with its assignments
 * and their problems, resolved for this user. Lets the native client load once and filter
 * locally (upcoming assignments, unsolved problems) instead of fetching per course.
 *
 * Visibility matches the per-course endpoints: admins and course staff (Faculty, TA) see
 * every assignment, published or not; students see only published assignments assigned to
 * them that have unlocked. Each problem includes a derived `solved` (full marks earned).
 * Answer-key files are never included.
 * @openapi
 * summary: My full course tree (client)
 * responses:
 *   200:
 *     description: Every visible course, each with its assignments and problems.
 *     content:
 *       application/json:
 *         schema:
 *           type: object
 *           properties:
 *             serverTime: { type: string, format: date-time }
 *             courses: { type: array, items: { type: object } }
 *   401: { description: Missing or invalid token. }
 */
export const GET = withClientAuth(async (_req, _ctx, { user }) => {
  return NextResponse.json(await buildClientCourseTree(user));
});
