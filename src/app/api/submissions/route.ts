import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';
import { readFormData } from '@/lib/api/request';
import { SubmissionCreateApiSchema } from '@/schemas/submission';
import { createSubmission } from '@/lib/create-submission';

/**
 * Submits a student's solution file for one assignment problem (multipart/form-data)
 * and queues it for evaluation. Requires a signed-in user who is enrolled in the
 * course (admins may submit anywhere). The problem must be linked to the assignment;
 * the authoritative course comes from the assignment, not the client. Enforces a
 * resubmit cooldown (429), the assignment's late/late-cutoff policy (403), an upload
 * size limit (413), and XML structure validation. On success the submission is
 * stored PENDING and returned with 202.
 * @openapi
 * summary: Submit a solution
 * requestBody:
 *   required: true
 *   content:
 *     multipart/form-data:
 *       schema:
 *         type: object
 *         required: [assignmentId, problemId]
 *         properties:
 *           assignmentId: { type: string }
 *           problemId: { type: string }
 *           courseId: { type: string, description: Ignored; derived from the assignment }
 *           file: { type: string, format: binary, description: The solution file (XML) }
 * responses:
 *   202: { description: Submission accepted and queued (status PENDING). }
 *   400: { description: "Missing fields, unlinked problem, or invalid file structure." }
 *   401: { description: Not signed in. }
 *   403: { description: "Not enrolled, or the late/late-cutoff policy rejected it." }
 *   404: { description: Assignment not found. }
 *   409: { description: Per-problem submission limit reached. }
 *   413: { description: File exceeds the system upload limit. }
 *   429: { description: Resubmit cooldown in effect (see Retry-After). }
 *   500: { description: Server error. }
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user || session.user.inactive) {
    console.warn('Unauthorized submission attempt');
    await createEnhancedActivityLog(prisma, req, {
      userId: undefined,
      action: 'SUBMISSION_UNAUTHORIZED',
      severity: 'SECURITY',
      category: 'SUBMISSION',
    });

    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const parsed = await readFormData(req, SubmissionCreateApiSchema);
  if (!parsed.ok) return parsed.response;

  // The whole pipeline lives in the shared service so the browser and the native
  // client create submissions through identical code.
  const result = await createSubmission({
    user: session.user,
    courseId: parsed.data.courseId,
    assignmentId: parsed.data.assignmentId,
    problemId: parsed.data.problemId,
    file: parsed.form.get('file') as File | null,
    req,
  });

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      { status: result.status, headers: result.headers },
    );
  }
  return NextResponse.json(result.submission, { status: 202 });
}
