import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';
import { logError } from '@/lib/api/activity';
import { withCourseAuth } from '@/lib/api/with-auth';
import { copyProblemInto } from '@/lib/problem-copy';
import { readJson } from '@/lib/api/request';
import { ProblemDuplicateApiSchema } from '@/schemas/problem';

/**
 * Duplicate a problem within the same course. The title/description come from the
 * request; the type, state cap, determinism flag, and the solution file (answer key) are
 * copied from the source and stay editable afterward. The solution file is copied to a
 * fresh name on disk so the two problems never share a file.
 *
 * @openapi
 * summary: Duplicate a course problem
 * parameters:
 *   - { name: id, in: path, required: true, schema: { type: string } }
 *   - { name: pid, in: path, required: true, schema: { type: string } }
 * requestBody:
 *   required: true
 *   content:
 *     application/json:
 *       schema:
 *         type: object
 *         required: [title]
 *         properties:
 *           title: { type: string }
 *           description: { type: string, nullable: true }
 * responses:
 *   201: { description: The newly created problem. }
 *   400: { description: Invalid body. }
 *   403: { description: Not course staff or a system admin. }
 *   404: { description: Source problem not found in this course. }
 *   500: { description: Server error. }
 */
export const POST = withCourseAuth(
  async (req, ctx, { user, courseId }) => {
    const { pid: problemId } = await ctx.params;
    try {
      const source = await prisma.problem.findFirst({ where: { id: problemId, courseId } });
      if (!source) {
        return NextResponse.json({ error: 'Problem not found' }, { status: 404 });
      }

      const parsed = await readJson(req, ProblemDuplicateApiSchema);
      if (!parsed.ok) return parsed.response;
      const { title, description, descriptionJson } = parsed.data;

      const { created, copiedFileName } = await copyProblemInto({
        source,
        courseId,
        title,
        description,
        descriptionJson,
      });

      await createEnhancedActivityLog(prisma, req, {
        userId: user.id,
        action: 'DUPLICATE_PROBLEM',
        severity: 'INFO',
        category: 'PROBLEM',
        courseId,
        problemId: created.id,
        metadata: {
          userId: user.id,
          courseId,
          sourceProblemId: source.id,
          newProblemId: created.id,
          title: created.title,
          copiedFile: !!copiedFileName,
        },
      });

      return NextResponse.json(created, { status: 201 });
    } catch (err) {
      console.error('Problem duplication error:', err);
      await logError(req, {
        userId: user.id,
        action: 'PROBLEM_DUPLICATE_ERROR',
        category: 'PROBLEM',
        courseId,
        problemId,
        error: err,
      });
      return NextResponse.json({ error: 'Failed to duplicate problem' }, { status: 500 });
    }
  },
  { access: 'manage', deniedAction: 'PROBLEM_DUPLICATE_DENIED', blockWhenArchived: true },
);
