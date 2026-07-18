/**
 * Resolves the deadline fields that actually apply to one student for an assignment,
 * given the assignment's base ("Everyone") values and any per-target overrides.
 *
 * Pure and DB-free, like `submission-window.ts`: callers fetch the base fields and the
 * override rows, then pass them in. Every deadline decision (submit enforcement, the
 * student calendar, the student assignment views) should route the base values through
 * here so per-student extensions are honored consistently.
 *
 * Inherit rule: each override field is nullable and null means "use the base value", so
 * an override can move only the due date and keep the base late policy. `allowLate=false`
 * on the effective result forces the effective cutoff to null (there is no late window),
 * so read surfaces never show a stale "until" date.
 *
 * Defensive clamp: base edits are not re-validated against every existing override, so an
 * override that only moved unlockAt could end up with unlock > due, or a base cutoff edit
 * could land before an override's due. We keep the window monotonic here
 * (unlock <= due <= cutoff) so enforcement can never invert.
 */
import type { DeadlineFields } from '@/lib/submission-window';

export type OverrideRow = {
  targetType: 'STUDENT' | 'GROUP';
  userId: string | null;
  groupId: string | null;
  unlockAt: Date | null;
  dueDate: Date | null;
  lateCutoff: Date | null;
  allowLateSubmissions: boolean | null;
};

export type EffectiveDeadline = DeadlineFields & {
  source: 'base' | 'student-override' | 'group-override';
};

const maxDate = (a: Date, b: Date): Date => (a.getTime() >= b.getTime() ? a : b);

/**
 * Resolve the effective deadline fields for `studentId`. Precedence is
 * student > group > base: a STUDENT override for this student wins, else a GROUP override
 * for one of the student's groups (`studentGroupIds`), else the base. Null override fields
 * inherit the base. A student is never targeted more than one way for an assignment
 * (enforced at assign time), so at most one override actually applies; the precedence is a
 * safety net. Pass `studentGroupIds` = [] (the default) to ignore group targets.
 */
export function effectiveDeadline(
  base: DeadlineFields,
  overrides: OverrideRow[],
  studentId: string,
  studentGroupIds: readonly string[] = [],
): EffectiveDeadline {
  const studentOv = overrides.find((o) => o.targetType === 'STUDENT' && o.userId === studentId);
  const groupOv = studentOv
    ? undefined
    : overrides.find(
        (o) => o.targetType === 'GROUP' && o.groupId != null && studentGroupIds.includes(o.groupId),
      );
  const ov = studentOv ?? groupOv;

  const allowLate = ov?.allowLateSubmissions ?? base.allowLateSubmissions;
  const unlockAt = ov?.unlockAt ?? base.unlockAt;
  let dueDate = ov?.dueDate ?? base.dueDate;
  // A null late window means no cutoff, so read surfaces show the due date as the close.
  let lateCutoff = allowLate ? (ov?.lateCutoff ?? base.lateCutoff) : null;

  // Keep the window monotonic regardless of how base/override fields were combined.
  if (unlockAt) dueDate = maxDate(dueDate, unlockAt);
  if (lateCutoff) lateCutoff = maxDate(lateCutoff, dueDate);

  return {
    unlockAt,
    dueDate,
    lateCutoff,
    allowLateSubmissions: allowLate,
    source: studentOv ? 'student-override' : groupOv ? 'group-override' : 'base',
  };
}
