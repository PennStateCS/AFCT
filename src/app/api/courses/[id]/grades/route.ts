import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';
import { withCourseAuth } from '@/lib/api/with-auth';
import { parsePageParams } from '@/lib/api/request';
import { getCourseGradeColumns, getCourseGradePage } from '@/lib/course-grades';

// The grades tab refetches on focus and on an interval; only record a view once per
// user / course / window so a background refetch doesn't flood the audit log.
const GRADES_VIEW_THROTTLE_MS = 10 * 60 * 1000;

const DEFAULT_PAGE_SIZE = 10;
const MAX_PAGE_SIZE = 100;

/**
 * The gradebook, one page of students at a time.
 *
 * `?part=columns` returns the assignment columns and the course's student total, which the
 * table caches for the course. Without `part` it returns one page of students, each row
 * carrying that student's assigned flags and their summed assignment grades.
 *
 * The whole students x assignments matrix used to be returned in one go (as `structure`
 * plus `values`), which does not survive a course with a thousand students. The full matrix
 * still exists for the LMS export, which builds it server-side in its own route.
 *
 * Course staff (faculty or TAs) or a system admin. Reading grade values is a FERPA-relevant
 * access, so it is recorded (throttled) in the audit log.
 * @openapi
 * summary: Get a page of the course gradebook
 * parameters:
 *   - { name: id, in: path, required: true, schema: { type: string } }
 *   - name: part
 *     in: query
 *     required: false
 *     description: "`columns` returns the assignment columns and the student total; omitted returns one page of students with their grades."
 *     schema: { type: string, enum: [columns] }
 *   - { name: page, in: query, schema: { type: integer, minimum: 1, default: 1 } }
 *   - { name: pageSize, in: query, schema: { type: integer, minimum: 1, maximum: 100, default: 10 } }
 *   - { name: q, in: query, description: "Match on the student's name or email", schema: { type: string } }
 *   - { name: sortBy, in: query, description: "lastName, firstName, email, totalGrade, or an assignment id", schema: { type: string } }
 *   - { name: sortDir, in: query, schema: { type: string, enum: [asc, desc], default: asc } }
 * responses:
 *   200:
 *     description: Either the columns payload or one page of student rows.
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
 *             assignments: { type: array, items: { type: object } }
 *             totalStudents: { type: integer }
 *   401: { description: Not signed in. }
 *   403: { description: Not course staff (faculty or TAs) or a system admin. }
 *   500: { description: Server error. }
 */
export const GET = withCourseAuth(
  async (req, _ctx, { user, courseId }) => {
    try {
      const url = new URL(req.url);

      // Columns carry no grade values, so they are not the FERPA-relevant read and are not
      // audited, matching what `?part=structure` did before.
      if (url.searchParams.get('part') === 'columns') {
        return NextResponse.json(await getCourseGradeColumns(courseId));
      }

      const { page, pageSize, skip, take } = parsePageParams(url.searchParams, {
        defaultSize: DEFAULT_PAGE_SIZE,
        maxSize: MAX_PAGE_SIZE,
      });
      const q = (url.searchParams.get('q') ?? '').trim();
      const sortDir: 'asc' | 'desc' = url.searchParams.get('sortDir') === 'desc' ? 'desc' : 'asc';

      const { rows, total } = await getCourseGradePage({
        courseId,
        skip,
        take,
        q: q || undefined,
        sortBy: url.searchParams.get('sortBy') ?? undefined,
        sortDir,
      });

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
            // The COURSE's student count, not the page's. This used to be the size of the
            // whole matrix, and paginating must not quietly redefine it as "rows on one
            // page": the log is research data and its meaning has to stay stable across
            // years. The throttle above already keeps paging from multiplying entries.
            metadata: { studentCount: total },
          });
        }
      } catch (logErr) {
        console.error('Failed to log grades view:', logErr);
      }

      return NextResponse.json({
        rows,
        total,
        page,
        pageSize,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
      });
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
