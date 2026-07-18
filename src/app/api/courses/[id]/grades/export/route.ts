import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';
import { logError } from '@/lib/api/activity';
import { withCourseAuth } from '@/lib/api/with-auth';
import { getCourseGradeMatrix } from '@/lib/course-grades';
import { buildLmsGradesCsv, type LmsPlatform, type LmsStudentRow } from '@/lib/lms-grade-export';

const PLATFORMS: LmsPlatform[] = ['canvas', 'blackboard', 'moodle', 'brightspace', 'generic'];
// UTF-8 BOM so Excel on Windows renders accented names instead of mojibake.
const BOM = String.fromCharCode(0xfeff);

/**
 * Builds an import-ready LMS gradebook CSV server-side and returns it as a download.
 * The export is audited here (atomically with generation) rather than via a separate,
 * skippable client call. Course staff (faculty or TAs) or a system admin.
 * @openapi
 * summary: Export course grades as an LMS CSV
 * parameters:
 *   - { name: id, in: path, required: true, schema: { type: string } }
 *   - { name: platform, in: query, schema: { type: string, enum: [canvas, blackboard, moodle, brightspace, generic] } }
 *   - { name: assignments, in: query, description: "Comma-separated assignment ids, or 'all' / omitted for the whole gradebook", schema: { type: string } }
 * responses:
 *   200: { description: A CSV file (text/csv) as an attachment. }
 *   400: { description: No matching assignments to export. }
 *   401: { description: Not signed in. }
 *   403: { description: Not course staff (faculty or TAs) or a system admin. }
 *   500: { description: Server error. }
 */
export const GET = withCourseAuth(
  async (req, _ctx, { user, courseId }) => {
    try {
      const url = new URL(req.url);
      const platformRaw = (url.searchParams.get('platform') ?? '').toLowerCase();
      const platform: LmsPlatform = (PLATFORMS as string[]).includes(platformRaw)
        ? (platformRaw as LmsPlatform)
        : 'generic';

      const assignmentsParam = (url.searchParams.get('assignments') ?? '').trim();
      const requestedIds = assignmentsParam
        ? assignmentsParam
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        : [];
      const wantAll = requestedIds.length === 0 || requestedIds.includes('all');

      const { students, assignments, grades } = await getCourseGradeMatrix(courseId);

      // Keep gradebook order; select the requested assignments (or all).
      const selected = wantAll
        ? assignments
        : assignments.filter((a) => requestedIds.includes(a.id));

      if (selected.length === 0) {
        return NextResponse.json({ error: 'No matching assignments to export' }, { status: 400 });
      }

      const rows: LmsStudentRow[] = students.map((s) => {
        const row: LmsStudentRow = {
          id: s.id,
          email: s.email ?? '',
          firstName: s.firstName ?? undefined,
          lastName: s.lastName ?? undefined,
        };
        for (const a of selected) row[a.id] = grades[s.id]?.[a.id] ?? null;
        return row;
      });

      const { csvContent, filenamePrefix } = buildLmsGradesCsv(
        platform,
        rows,
        selected.map((a) => ({ id: a.id, title: a.title })),
      );

      // Audit the export atomically with generating it (can't be skipped by the client).
      await createEnhancedActivityLog(prisma, req, {
        userId: user.id,
        action: 'GRADES_EXPORTED',
        severity: 'INFO',
        category: 'SUBMISSION',
        courseId,
        metadata: {
          platform,
          wholeGradebook: wantAll,
          assignmentCount: selected.length,
          studentCount: students.length,
        },
      });

      const slug =
        (selected[0]?.title ?? 'gradebook')
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/(^-|-$)/g, '') || 'gradebook';
      const timestamp = new Date().toISOString().replace('T', '_').replace(/:/g, '-').split('.')[0];
      const filename = `${filenamePrefix}-${slug}-${timestamp}.csv`;

      return new NextResponse(BOM + csvContent, {
        status: 200,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="${filename}"`,
          'Cache-Control': 'no-store',
        },
      });
    } catch (error) {
      console.error('GET /api/courses/[id]/grades/export error:', error);
      await logError(req, { userId: user.id, action: 'GRADES_EXPORT_ERROR', error, courseId });
      return NextResponse.json({ error: 'Failed to export grades' }, { status: 500 });
    }
  },
  { access: 'manage', deniedAction: 'GRADES_EXPORT_DENIED', blockWhenArchived: true },
);
