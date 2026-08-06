import { NextResponse } from 'next/server';
import { logError } from '@/lib/api/activity';
import { apiError } from '@/lib/api/http';
import { withCourseAuth } from '@/lib/api/with-auth';
import { parsePageParams } from '@/lib/api/request';
import { getUsersPage, type UsersSearchField } from '@/lib/users-list';

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 50;

const SEARCH_FIELDS: UsersSearchField[] = ['all', 'firstName', 'lastName', 'email'];

/**
 * Accounts that could be enrolled in this course: active users who are not already on its
 * roster, searched server-side. Course staff (faculty or TAs) or a system admin.
 *
 * Backs the Enroll User dialog, which used to fetch every account in the installation and
 * subtract the course's roster in the browser. That stopped being correct once the roster
 * itself was paginated (a partial roster would have offered people who are already members)
 * and it never scaled to a large user table.
 *
 * Inactive accounts are left out because the enroll endpoint refuses them anyway, so
 * offering one could only produce a 409.
 * @openapi
 * summary: Search accounts that can be enrolled in a course
 * parameters:
 *   - { name: id, in: path, required: true, schema: { type: string } }
 *   - { name: page, in: query, schema: { type: integer, minimum: 1, default: 1 } }
 *   - { name: pageSize, in: query, schema: { type: integer, minimum: 1, maximum: 50, default: 25 } }
 *   - { name: q, in: query, description: "Match on first name, last name, or email", schema: { type: string } }
 *   - { name: field, in: query, schema: { type: string, enum: [all, firstName, lastName, email] } }
 * responses:
 *   200:
 *     description: One page of enrollable accounts.
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
 *   401: { description: Not signed in. }
 *   403: { description: Not course staff (faculty or TAs) or a system admin. }
 *   404: { description: Course not found. }
 *   500: { description: Server error. }
 */
export const GET = withCourseAuth(
  async (req, _ctx, { user, courseId }) => {
    try {
      const url = new URL(req.url);
      const { page, pageSize, skip, take } = parsePageParams(url.searchParams, {
        defaultSize: DEFAULT_PAGE_SIZE,
        maxSize: MAX_PAGE_SIZE,
      });

      const q = (url.searchParams.get('q') ?? '').trim();
      const fieldRaw = (url.searchParams.get('field') ?? 'all').trim();
      const field = SEARCH_FIELDS.find((f) => f === fieldRaw) ?? 'all';

      const { rows, total } = await getUsersPage({
        skip,
        take,
        q: q || undefined,
        field,
        // Active accounts only; `inactive` takes the still-allowed values.
        inactive: [false],
        excludeCourseId: courseId,
        sortBy: 'lastName',
        sortDir: 'asc',
      });

      return NextResponse.json({
        rows,
        total,
        page,
        pageSize,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
      });
    } catch (error) {
      console.error('GET /api/courses/[id]/enrollable-users error:', error);
      await logError(req, {
        userId: user.id,
        action: 'COURSE_ENROLLABLE_USERS_ERROR',
        category: 'COURSE',
        error,
      });
      return apiError(500, 'Failed to search accounts');
    }
  },
  { access: 'manage', deniedAction: 'COURSE_ENROLLABLE_USERS_ACCESS_DENIED' },
);
