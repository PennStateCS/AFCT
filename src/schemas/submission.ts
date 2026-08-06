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

/** Rows per page when the Autograder page does not ask, and the ceiling it may ask for. */
export const AUTOGRADER_DEFAULT_PAGE_SIZE = 10;
export const AUTOGRADER_MAX_PAGE_SIZE = 100;

/**
 * One page request for the Autograder page's table: scope, search, filters, sort and
 * pagination. A body rather than a query string because the scope can carry hundreds of
 * problem ids, which is why this endpoint was a POST to begin with.
 *
 * Every list defaults to empty, and empty means "no constraint at this level". That is how
 * the page asks for everything without enumerating every id in the installation.
 */
export const AutograderSubmissionsQuerySchema = z.object({
  courseIds: z.array(z.string()).default([]),
  assignmentIds: z.array(z.string()).default([]),
  problemIds: z.array(z.string()).default([]),
  q: z.string().trim().optional(),
  field: z.enum(['all', 'student', 'course', 'assignment', 'problem', 'file']).default('all'),
  timing: z.array(z.enum(['ontime', 'late'])).default([]),
  status: z
    .array(z.enum(['pending', 'processing', 'failed', 'correct', 'incorrect']))
    .default([]),
  page: z.coerce.number().int().min(1).default(1),
  // Clamped rather than rejected, matching `parsePageParams`, so an out-of-range value
  // from a stale client still returns a sane page instead of a 400.
  pageSize: z.coerce
    .number()
    .int()
    .catch(AUTOGRADER_DEFAULT_PAGE_SIZE)
    .transform((n) => Math.min(Math.max(n, 1), AUTOGRADER_MAX_PAGE_SIZE))
    .default(AUTOGRADER_DEFAULT_PAGE_SIZE),
  sortBy: z.string().optional(),
  sortDir: z.enum(['asc', 'desc']).default('desc'),
});
