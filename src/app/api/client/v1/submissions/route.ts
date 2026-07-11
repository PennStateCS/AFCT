import { NextResponse } from 'next/server';
import { withClientAuth } from '@/lib/api/with-client-auth';
import { readFormData } from '@/lib/api/request';
import { SubmissionCreateApiSchema } from '@/schemas/submission';
import { createSubmission } from '@/lib/create-submission';

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
