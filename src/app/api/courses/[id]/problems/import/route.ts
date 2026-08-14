import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';
import { logDenial, logError } from '@/lib/api/activity';
import { withCourseAuth } from '@/lib/api/with-auth';
import { canManageCourse } from '@/lib/permissions';
import { copyProblemInto } from '@/lib/problem-copy';
import { readJson } from '@/lib/api/request';
import { ProblemImportApiSchema } from '@/schemas/problem';

/**
 * Imports a problem from ANOTHER course the caller can manage into this course. The
 * title/description come from the request; the type, state cap, determinism flag, and
 * the solution file (answer key) are copied from the source. The solution file is copied
 * to a fresh name on disk so the two problems never share a file.
 *
 * Permission is tiered: the wrapper gates the destination course (manage), and the caller
 * must also be able to manage the source course.
 *
 * @openapi
 * summary: Import a problem from another course
 * parameters:
 *   - { name: id, in: path, required: true, schema: { type: string }, description: Destination course id }
 * requestBody:
 *   required: true
 *   content:
 *     application/json:
 *       schema:
 *         type: object
 *         required: [sourceCourseId, sourceProblemId, title]
 *         properties:
 *           sourceCourseId: { type: string }
 *           sourceProblemId: { type: string }
 *           title: { type: string }
 *           description: { type: string, nullable: true }
 * responses:
 *   201: { description: The newly created problem. }
 *   400: { description: "Invalid body, or the source is the destination course." }
 *   403: { description: Caller cannot manage the destination or the source course. }
 *   404: { description: Source problem not found in the source course. }
 *   500: { description: Server error. }
 */
export const POST = withCourseAuth(
  async (req, _ctx, { user, courseId }) => {
    try {
      const parsed = await readJson(req, ProblemImportApiSchema);
      if (!parsed.ok) return parsed.response;
      const { sourceCourseId, sourceProblemId, title, description, descriptionJson } = parsed.data;

      // Importing from the same course is what Duplicate is for; reject it here so the
      // two flows stay distinct.
      if (sourceCourseId === courseId) {
        return NextResponse.json(
          { error: 'Use Duplicate to copy a problem within the same course.' },
          { status: 400 },
        );
      }

      // The wrapper gated the DESTINATION course; the caller must also be staff (or an
      // admin) in the SOURCE course to read and import from it.
      if (!(await canManageCourse(user, sourceCourseId))) {
        return logDenial(req, {
          userId: user.id,
          action: 'PROBLEM_IMPORT_DENIED',
          category: 'PROBLEM',
          courseId,
          metadata: { sourceCourseId, sourceProblemId },
        });
      }

      const source = await prisma.problem.findFirst({
        where: { id: sourceProblemId, courseId: sourceCourseId },
      });
      if (!source) {
        return NextResponse.json({ error: 'Problem not found' }, { status: 404 });
      }

      const { created, copiedFileName } = await copyProblemInto({
        source,
        courseId,
        title,
        description,
        descriptionJson,
      });

      await createEnhancedActivityLog(prisma, req, {
        userId: user.id,
        action: 'IMPORT_PROBLEM',
        severity: 'INFO',
        category: 'PROBLEM',
        courseId,
        problemId: created.id,
        metadata: {
          userId: user.id,
          courseId,
          sourceCourseId,
          sourceProblemId: source.id,
          newProblemId: created.id,
          title: created.title,
          copiedFile: !!copiedFileName,
        },
      });

      return NextResponse.json(created, { status: 201 });
    } catch (err) {
      console.error('Problem import error:', err);
      await logError(req, {
        userId: user.id,
        action: 'PROBLEM_IMPORT_ERROR',
        category: 'PROBLEM',
        courseId,
        error: err,
      });
      return NextResponse.json({ error: 'Failed to import problem' }, { status: 500 });
    }
  },
  { access: 'manage', deniedAction: 'PROBLEM_IMPORT_DENIED', blockWhenArchived: true },
);
