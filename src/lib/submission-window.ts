/**
 * The single, server-side resolver for "may a submission be accepted right now?".
 *
 * Deadline enforcement is **integrity-critical**: it must be computed on the server
 * from stored **UTC** instants versus the server clock — never from a client-supplied
 * time or timezone (a student changing their browser zone or OS clock must not move
 * the deadline). Centralizing it here means every caller (submit route, calendar,
 * reminders) makes the *same* decision, and future work — per-student due-date
 * **overrides** and a **grace period** (see `docs/roadmap.md`) — slots into this one
 * function instead of every comparison site.
 *
 * This mirrors the current submit-route logic exactly:
 *   - on time            → accepted (not late)
 *   - late + late allowed + before cutoff (or no cutoff) → accepted (late)
 *   - late + late not allowed                            → rejected `late-not-allowed`
 *   - late + past the cutoff                             → rejected `cutoff-passed`
 */

/** The assignment fields the window depends on (all UTC instants). */
export type DeadlineFields = {
  dueDate: Date;
  allowLateSubmissions: boolean;
  lateCutoff: Date | null;
};

export type SubmissionWindow =
  | { accepted: true; late: boolean }
  | { accepted: false; late: true; reason: 'late-not-allowed' | 'cutoff-passed' };

/**
 * Decide whether a submission is within the assignment's window at `now` (defaults to
 * the server clock). Pure and synchronous — pass the resolved deadline fields.
 */
export function evaluateSubmissionWindow(
  assignment: DeadlineFields,
  now: Date = new Date(),
): SubmissionWindow {
  const isLate = now.getTime() > assignment.dueDate.getTime();

  if (!isLate) {
    return { accepted: true, late: false };
  }

  if (!assignment.allowLateSubmissions) {
    return { accepted: false, late: true, reason: 'late-not-allowed' };
  }

  if (assignment.lateCutoff && now.getTime() > assignment.lateCutoff.getTime()) {
    return { accepted: false, late: true, reason: 'cutoff-passed' };
  }

  return { accepted: true, late: true };
}
