import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withClientAuth } from '@/lib/api/with-client-auth';
import { apiError } from '@/lib/api/http';
import { readFormData } from '@/lib/api/request';
import { SubmissionCreateApiSchema } from '@/schemas/submission';
import { createSubmission } from '@/lib/create-submission';

/**
 * The caller's own submission history for one problem (attempt list), newest first —
 * so the client can show past attempts and drill into any one's result via
 * `GET /submissions/{id}`. Scoped to the token's user, so it never exposes anyone
 * else's work.
 * @openapi
 * summary: List my submissions for a problem (client)
 * parameters:
 *   - { name: assignmentId, in: query, required: true, schema: { type: string } }
 *   - { name: problemId, in: query, required: true, schema: { type: string } }
 * responses:
 *   200:
 *     description: The caller's attempts for the problem, newest first.
 *     content:
 *       application/json:
 *         schema:
 *           type: object
 *           properties:
 *             submissions: { type: array, items: { type: object } }
 *   400: { description: Missing assignmentId or problemId. }
 *   401: { description: Missing or invalid token. }
 */
export const GET = withClientAuth(async (req, _ctx, { user }) => {
  const { searchParams } = new URL(req.url);
  const assignmentId = searchParams.get('assignmentId');
  const problemId = searchParams.get('problemId');
  if (!assignmentId || !problemId) {
    return apiError(400, 'assignmentId and problemId are required');
  }

  const submissions = await prisma.submission.findMany({
    where: { assignmentId, problemId, studentId: user.id },
    orderBy: { submittedAt: 'desc' },
    select: { id: true, status: true, correct: true, submittedAt: true },
  });

  return NextResponse.json({
    submissions: submissions.map((s) => ({
      id: s.id,
      status: s.status,
      correct: s.correct,
      submittedAt: s.submittedAt.toISOString(),
    })),
  });
});

/**
 * Submit a solution file (client). Same multipart body, validation, caps, cooldown,
 * late policy, storage, and queueing as the web `/api/submissions` — it runs the same
 * `createSubmission` service — but authenticated by a bearer token. Returns 202 with
 * the new submission's id + status.
 * @openapi
 * summary: Submit a solution (client)
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
 *           file: { type: string, format: binary, description: The solution file (XML) }
 * responses:
 *   202: { description: Submission accepted and queued (status PENDING). }
 *   400: { description: "Missing fields, unlinked problem, or invalid file structure." }
 *   401: { description: Missing or invalid token. }
 *   403: { description: "Not enrolled, or the late policy rejected it." }
 *   404: { description: Assignment not found. }
 *   409: { description: Per-problem submission limit reached. }
 *   413: { description: File exceeds the system upload limit. }
 *   429: { description: Resubmit cooldown in effect (see Retry-After). }
 *   500: { description: Server error. }
 */
export const POST = withClientAuth(async (req, _ctx, { user }) => {
  const parsed = await readFormData(req, SubmissionCreateApiSchema);
  if (!parsed.ok) return parsed.response;

  const result = await createSubmission({
    user,
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
  return NextResponse.json(
    { submissionId: result.submission.id, status: result.submission.status },
    { status: 202 },
  );
});
