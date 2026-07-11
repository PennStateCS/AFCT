// src/schemas/submission.ts
import { z } from 'zod';

/**
 * Scalar fields of the multipart submission body (the `file` is read separately).
 * `assignmentId`/`problemId` are optional here because the handler emits a specific
 * SUBMISSION_INVALID_REQUEST audit log when they're missing; `courseId` is accepted
 * but ignored (the authoritative course comes from the assignment). Shared by the
 * web `/api/submissions` route and the native-client submissions endpoint.
 */
export const SubmissionCreateApiSchema = z.object({
  courseId: z.string().optional(),
  assignmentId: z.string().optional(),
  problemId: z.string().optional(),
});
