/**
 * Small pure helpers for shaping course/assignment API responses, extracted from the
 * handlers that repeated them verbatim.
 */

/**
 * Sums the per-problem `maxPoints` of an assignment's problem links into the
 * assignment's total points, treating missing/non-finite values as zero.
 */
export function sumProblemPoints(
  problems: Array<{ maxPoints?: number | null }> | null | undefined,
): number {
  return (problems ?? []).reduce((sum, ap) => {
    const value = typeof ap.maxPoints === 'number' ? ap.maxPoints : 0;
    return sum + (Number.isFinite(value) ? value : 0);
  }, 0);
}

/**
 * Flattens a course roster into the single `enrolled` array the frontend expects:
 * each user object annotated with its `courseRole`.
 */
export function toEnrolled<U extends object, R>(
  roster: Array<{ role: R; user: U }>,
): Array<U & { courseRole: R }> {
  return roster.map((r) => ({ ...r.user, courseRole: r.role }));
}
