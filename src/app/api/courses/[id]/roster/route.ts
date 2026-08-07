import { NextResponse } from 'next/server';
import { z } from 'zod';
import type { CourseRole, EnrollmentStatus } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';
import { logError } from '@/lib/api/activity';
import { apiError } from '@/lib/api/http';
import { withCourseAuth } from '@/lib/api/with-auth';
import { readJson, parsePageParams } from '@/lib/api/request';
import { getCourseRosterPage, type RosterSearchField } from '@/lib/course-roster-list';

const EnrollBody = z.object({ userId: z.string().min(1, 'Missing userId') });

const DEFAULT_PAGE_SIZE = 10;
const MAX_PAGE_SIZE = 100;

const ROLES: CourseRole[] = ['FACULTY', 'TA', 'STUDENT'];
const STATUSES: EnrollmentStatus[] = ['ENROLLED', 'DROPPED'];
const SEARCH_FIELDS: RosterSearchField[] = ['all', 'name', 'email'];

/**
 * One page of a course's roster, with search, filters, sort and pagination all applied in
 * the database. Course staff (faculty or TAs) or a system admin.
 *
 * A staff surface, so dropped students are included and badged rather than hidden. Students
 * never reach this route; their course payload carries staff names only and no peer rows.
 *
 * Deliberately does not log the read. Staff reading their own course's roster is routine,
 * and paginating would turn one read into one log per page flipped through, which would
 * distort ActivityLog as research data. See docs/logging-policy.md section 3.
 * @openapi
 * summary: List a course's roster (paginated)
 * parameters:
 *   - { name: id, in: path, required: true, schema: { type: string } }
 *   - { name: page, in: query, schema: { type: integer, minimum: 1, default: 1 } }
 *   - { name: pageSize, in: query, schema: { type: integer, minimum: 1, maximum: 100, default: 10 } }
 *   - { name: q, in: query, description: "Match on name or email", schema: { type: string } }
 *   - { name: field, in: query, schema: { type: string, enum: [all, name, email] } }
 *   - { name: role, in: query, description: "Repeatable", schema: { type: array, items: { type: string, enum: [FACULTY, TA, STUDENT] } } }
 *   - { name: status, in: query, description: "Repeatable", schema: { type: array, items: { type: string, enum: [ENROLLED, DROPPED] } } }
 *   - { name: sortBy, in: query, schema: { type: string, enum: [lastName, firstName, email, role, enrollmentStatus] } }
 *   - { name: sortDir, in: query, schema: { type: string, enum: [asc, desc], default: asc } }
 * responses:
 *   200:
 *     description: One page of roster members.
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

      // Repeatable multi-selects, filtered against the canonical values so an unknown
      // token narrows nothing rather than reaching Prisma.
      const roles = url.searchParams
        .getAll('role')
        .map((v) => v.trim().toUpperCase())
        .filter((v): v is CourseRole => (ROLES as string[]).includes(v));
      const statuses = url.searchParams
        .getAll('status')
        .map((v) => v.trim().toUpperCase())
        .filter((v): v is EnrollmentStatus => (STATUSES as string[]).includes(v));

      const sortDir: 'asc' | 'desc' = url.searchParams.get('sortDir') === 'desc' ? 'desc' : 'asc';
      const sortBy = url.searchParams.get('sortBy') ?? undefined;

      const { rows, total } = await getCourseRosterPage({
        courseId,
        skip,
        take,
        q: q || undefined,
        field,
        roles,
        statuses,
        sortBy,
        sortDir,
      });

      return NextResponse.json({
        rows,
        total,
        page,
        pageSize,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
      });
    } catch (error) {
      console.error('GET /api/courses/[id]/roster error:', error);
      await logError(req, {
        userId: user.id,
        action: 'COURSE_ROSTER_LIST_ERROR',
        category: 'COURSE',
        error,
      });
      return apiError(500, 'Failed to load the roster');
    }
  },
  { access: 'manage', deniedAction: 'COURSE_ROSTER_ACCESS_DENIED' },
);

/**
 * Adds a single user to a course roster. Course staff (faculty or TAs) or a system
 * admin. A brand-new member is added as STUDENT; callers don't pick the role. Purely
 * additive: an already-enrolled member keeps their current role (changing a role,
 * including demoting staff, is the dedicated faculty-gated role-change endpoint's job).
 * @openapi
 * summary: Enroll a user in a course
 * parameters:
 *   - { name: id, in: path, required: true, schema: { type: string } }
 * requestBody:
 *   required: true
 *   content:
 *     application/json:
 *       schema:
 *         type: object
 *         required: [userId]
 *         properties:
 *           userId: { type: string }
 * responses:
 *   200:
 *     description: Enrolled.
 *     content:
 *       application/json:
 *         schema: { type: object, properties: { success: { type: boolean } } }
 *   400: { description: Missing userId. }
 *   401: { description: Not signed in. }
 *   403: { description: Not course staff (faculty or TAs) or a system admin. }
 *   404: { description: Target user not found. }
 *   409: { description: The target user is inactive. }
 *   500: { description: Server error. }
 */
export const POST = withCourseAuth(
  async (req, _ctx, { user, courseId }) => {
    try {
      const parsed = await readJson(req, EnrollBody);
      if (!parsed.ok) return parsed.response;
      const { userId } = parsed.data;

      const targetUser = await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, inactive: true },
      });

      if (!targetUser) {
        return NextResponse.json({ error: 'User not found' }, { status: 404 });
      }

      if (targetUser.inactive == true) {
        // The caller is authorized; it's the enrollment target that's disabled.
        // 409 (conflict), not 401, which would look like the caller is signed out.
        return NextResponse.json({ error: 'User is inactive' }, { status: 409 });
      }

      const roleToAssign = 'STUDENT';

      await prisma.roster.upsert({
        where: {
          courseId_userId: {
            courseId,
            userId,
          },
        },
        create: {
          courseId,
          userId,
          role: roleToAssign,
        },
        // Re-adding restores access: a previously DROPPED student is re-enrolled. We set
        // only status/droppedAt, never role, so this can't demote a FACULTY/TA member
        // (that stays the faculty-gated role-change route's job); for an already-enrolled
        // member or a staff row it's a no-op (they are ENROLLED with droppedAt null already).
        update: { status: 'ENROLLED', droppedAt: null },
      });

      await createEnhancedActivityLog(prisma, req, {
        userId: user.id,
        action: 'ENROLL_USER',
        severity: 'INFO',
        category: 'COURSE',
        courseId,
        metadata: {
          courseId: courseId,
          enrolledUserId: userId,
          role: roleToAssign,
        },
      });

      return NextResponse.json({ success: true });
    } catch (error) {
      console.error('Enrollment error:', error);
      await logError(req, {
        userId: user.id,
        action: 'COURSE_ENROLL_ERROR',
        category: 'COURSE',
        error,
        courseId,
      });
      return NextResponse.json({ error: 'Failed to enroll user' }, { status: 500 });
    }
  },
  { access: 'manage', blockWhenArchived: true, deniedAction: 'COURSE_ENROLL_DENIED' },
);
