import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import path from 'path';
import { promises as fs } from 'fs';
import { auth } from '@/lib/auth';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';
import { canManageCourse } from '@/lib/permissions';

/**
 * Deletes a problem within a course, unconditionally cascading its submissions and
 * assignment links first, then removing the solution file. Staff only
 * (ADMIN/FACULTY/TA). The problem must belong to the course in the path. Unlike
 * DELETE /api/problems/[id], this does not refuse when the problem is used by an
 * assignment — it removes those links.
 * @openapi
 * summary: Delete a course problem
 * parameters:
 *   - { name: id, in: path, required: true, schema: { type: string } }
 *   - { name: pid, in: path, required: true, schema: { type: string } }
 * responses:
 *   200: { description: Problem deleted. }
 *   403: { description: Caller lacks a staff role. }
 *   404: { description: Problem not found in this course. }
 *   500: { description: Server error. }
 */
export async function DELETE(
  req: Request,
  context: { params: Promise<{ id: string; pid: string }> },
) {
  const { id: courseId, pid: problemId } = await context.params;

  try {
    const session = await auth();
    const user = session?.user;

    if (!user || !(await canManageCourse(user, courseId))) {
      await createEnhancedActivityLog(prisma, req, {
        userId: session?.user?.id ?? null,
        action: 'PROBLEM_DELETE_DENIED',
        severity: 'SECURITY',
        metadata: {},
      });
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    // Step 2: Verify that the problem exists and belongs to the specified course
    const problem = await prisma.problem.findFirst({
      where: { id: problemId, courseId },
    });

    if (!problem) {
      return NextResponse.json({ error: 'Problem not found.' }, { status: 404 });
    }

    // Step 3: Delete all student submissions for this problem
    await prisma.submission.deleteMany({
      where: { problemId },
    });

    // Step 4: Delete all assignment-problem links
    await prisma.assignmentProblem.deleteMany({
      where: { problemId },
    });

    // Step 5: Delete the problem record itself
    await prisma.problem.delete({
      where: { id: problemId },
    });

    // Step 6: Attempt to delete the associated solution file (if it exists)
    if (problem.fileName) {
      const filePath = path.join(
        process.cwd(),
        'private',
        'uploads',
        'solutions',
        problem.fileName,
      );
      try {
        await fs.unlink(filePath);
      } catch (fsErr: unknown) {
        if (fsErr instanceof Error && 'code' in fsErr && fsErr.code === 'ENOENT') {
          // File not found, ignore
        } else {
          console.error('Error deleting solution file:', fsErr);
        }
      }
    }

    // Step 7: Log the delete action to ActivityLog
    await createEnhancedActivityLog(prisma, req, {
      userId: user.id,
      action: 'DELETE_PROBLEM',
      severity: 'INFO',
      category: 'PROBLEM',
      courseId,
      problemId,
      metadata: {
        userId: user.id,
        courseId: courseId,
        problemId: problemId,
        problemTitle: problem.title,
        fileName: problem.fileName || null,
      },
    });

    // Step 8: Return success response
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('API DELETE error:', error);
    await createEnhancedActivityLog(prisma, req, {
      userId: null,
      action: 'PROBLEM_DELETE_ERROR',
      severity: 'ERROR',
      metadata: { error: error instanceof Error ? error.message : 'unknown error' },
    });
    return NextResponse.json({ error: 'Failed to delete problem.' }, { status: 500 });
  }
}
