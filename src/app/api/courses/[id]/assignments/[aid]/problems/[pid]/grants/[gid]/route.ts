import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withCourseAuth } from '@/lib/api/with-auth';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';
import { logError } from '@/lib/api/activity';

type Ctx = { params: Promise<{ id: string; aid: string; pid: string; gid: string }> };

/**
 * Revokes an extra-submission grant. Submissions already made stay untouched; the
 * target's cap simply returns to the shared value. Course staff (faculty or TAs) or a
 * system admin.
 * @openapi
 * summary: Revoke an extra-submission grant
 * parameters:
 *   - { name: id, in: path, required: true, schema: { type: string } }
 *   - { name: aid, in: path, required: true, schema: { type: string } }
 *   - { name: pid, in: path, required: true, schema: { type: string } }
 *   - { name: gid, in: path, required: true, schema: { type: string } }
 * responses:
 *   200: { description: The grant was removed. }
 *   401: { description: Not signed in. }
 *   403: { description: Not course staff or a system admin. }
 *   404: { description: Grant not found for this problem. }
 *   409: { description: Course is archived. }
 *   500: { description: Server error. }
 */
export const DELETE = withCourseAuth(
  async (req, ctx: Ctx, { user, courseId }) => {
    const { aid, pid, gid } = await ctx.params;
    try {
      // Scoped through the course so a foreign grant id can never resolve.
      const grant = await prisma.submissionGrant.findFirst({
        where: {
          id: gid,
          assignmentId: aid,
          problemId: pid,
          assignmentProblem: { assignment: { courseId } },
        },
      });
      if (!grant) {
        return NextResponse.json({ error: 'Grant not found' }, { status: 404 });
      }

      await prisma.submissionGrant.delete({ where: { id: gid } });

      await createEnhancedActivityLog(prisma, req, {
        userId: user.id,
        action: 'REVOKE_EXTRA_SUBMISSIONS',
        severity: 'INFO',
        category: 'ASSIGNMENT',
        courseId,
        assignmentId: aid,
        problemId: pid,
        metadata: {
          grantId: grant.id,
          targetUserId: grant.userId,
          targetGroupId: grant.groupId,
          targetType: grant.targetType,
          extraSubmissions: grant.extraSubmissions,
          reason: grant.reason,
        },
      });

      return NextResponse.json({ success: true });
    } catch (error) {
      console.error('DELETE submission grant error:', error);
      await logError(req, {
        userId: user.id,
        action: 'SUBMISSION_GRANT_DELETE_ERROR',
        category: 'ASSIGNMENT',
        courseId,
        assignmentId: aid,
        error,
      });
      return NextResponse.json({ error: 'Failed to revoke the grant' }, { status: 500 });
    }
  },
  { access: 'manage', deniedAction: 'SUBMISSION_GRANT_DELETE_DENIED', blockWhenArchived: true },
);
