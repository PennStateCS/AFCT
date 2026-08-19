import { apiPaths } from '@/lib/api-paths';
import type { LmsLinkSummary } from '@/lib/lti/link-labels';

/** One LMS link as it crosses the wire, where dates are strings. */
export type AssignmentLmsLink = Omit<LmsLinkSummary, 'addedAt'> & { addedAt: string };

/**
 * Read where an assignment appears in an LMS.
 *
 * Separate from the component so the distinction that matters can be tested directly: an empty
 * list is an answer, and everything else is a failure. This used to map a refusal or a dead
 * network onto `[]`, which the screen then reported as "not added to your LMS" - a claim about
 * somebody's LMS made from no information, and one that invites adding a duplicate link.
 *
 * Throws on a non-2xx response or a body that is not the expected shape; a network error throws
 * from `fetch` itself and is left to propagate for the same reason.
 */
export async function fetchAssignmentLmsLinks(
  courseId: string,
  assignmentId: string,
): Promise<AssignmentLmsLink[]> {
  const res = await fetch(apiPaths.assignmentLmsLinks(courseId, assignmentId));
  if (!res.ok) throw new Error(`Could not read the LMS links (${res.status})`);

  const body = (await res.json()) as { links?: unknown };
  if (!Array.isArray(body?.links)) {
    throw new Error('The LMS links came back in a shape AFCT does not understand');
  }
  return body.links as AssignmentLmsLink[];
}
