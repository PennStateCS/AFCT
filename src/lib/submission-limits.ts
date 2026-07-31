/**
 * Resolves the submission limit that actually applies to one submitter (a student, or a
 * group's shared submission set) for an assignment problem, given the problem's base
 * `maxSubmissions` and any per-target SubmissionGrant rows.
 *
 * Pure and DB-free, like `effective-deadline.ts`: callers fetch the base value and the
 * grant rows, then pass them in. Every limit decision (submit enforcement in
 * `create-submission.ts`, the student views, the native-client tree) should route through
 * here so a granted extra attempt is honored consistently everywhere.
 *
 * Semantics:
 * - `maxSubmissions <= 0` means unlimited (the historical sentinel). Unlimited stays
 *   unlimited: grants are a no-op and `max` comes back null so callers never render
 *   "0 remaining" for an unlimited problem.
 * - Grants are ADDITIVE and follow the submitter: a STUDENT grant for this student and a
 *   GROUP grant for any of their groups both count, summed. On a group assignment the
 *   count scope is group-wide, so a student-targeted grant raises the ceiling only for
 *   that member's own submit action; target the group to raise it for every member.
 */
export type SubmissionGrantRow = {
  targetType: 'STUDENT' | 'GROUP';
  userId: string | null;
  groupId: string | null;
  extraSubmissions: number;
};

export type EffectiveSubmissionLimit = {
  /** The cap that applies to this submitter; null = unlimited. */
  max: number | null;
  /** Extra submissions granted on top of the base (0 when none apply). */
  granted: number;
};

/**
 * Resolve the effective cap for `studentId`. Pass `studentGroupIds` = [] (the default)
 * to ignore group targets.
 */
export function effectiveMaxSubmissions(
  baseMax: number,
  grants: readonly SubmissionGrantRow[],
  studentId: string,
  studentGroupIds: readonly string[] = [],
): EffectiveSubmissionLimit {
  if (baseMax <= 0) return { max: null, granted: 0 };
  const granted = grants.reduce((sum, g) => {
    const applies =
      (g.targetType === 'STUDENT' && g.userId === studentId) ||
      (g.targetType === 'GROUP' && g.groupId != null && studentGroupIds.includes(g.groupId));
    // The DB CHECK keeps extraSubmissions > 0; the clamp keeps a bad row from ever
    // shrinking a cap below its base.
    return applies ? sum + Math.max(0, g.extraSubmissions) : sum;
  }, 0);
  return { max: baseMax + granted, granted };
}

/** Attempts left for a submitter who has already used `used`; null = unlimited. */
export function submissionsRemaining(
  limit: EffectiveSubmissionLimit,
  used: number,
): number | null {
  if (limit.max == null) return null;
  return Math.max(0, limit.max - used);
}
