'use client';

import { formatDateTimeInTimeZone } from '@/lib/date-format';

/** The assignment's own dates, before any override is applied. */
export type ScheduleBase = {
  dueDate?: string | Date;
  allowLateSubmissions?: boolean;
  lateCutoff?: string | Date | null;
};

/** The dates that actually apply to the selected student. */
export type EffectiveSchedule = {
  unlockAt: string | null;
  dueDate: string;
  lateCutoff: string | null;
  allowLateSubmissions: boolean;
  source: 'base' | 'student-override' | 'group-override';
};

type StudentScheduleProps = {
  /** The assignment's base dates. Null while they are still loading. */
  assignment: ScheduleBase | null;
  /** The selected student's resolved dates, when they are known. */
  effective?: EffectiveSchedule | null;
  loading?: boolean;
  timezone: string;
  className?: string;
};

/**
 * The dates that apply to the student being reviewed.
 *
 * These are NOT the assignment's dates. `effectiveDeadline` merges an override over the base
 * field by field, so one student can have a later cutoff while everything else matches, and a
 * grader deciding whether work was late needs to see which is which. Each field is compared
 * against the assignment's own value and marked individually; marking the whole line, or
 * always marking the due date, would point at values that did not change.
 */
export function StudentSchedule({
  assignment,
  effective = null,
  loading = false,
  timezone,
  className = '',
}: StudentScheduleProps) {
  if (loading) {
    return <span className={`text-muted-foreground text-sm ${className}`}>Loading assignment...</span>;
  }
  if (!assignment) return null;

  const eff = effective;
  const showDueDate = eff?.dueDate ?? assignment.dueDate ?? null;
  const showAllowLate = eff ? eff.allowLateSubmissions : (assignment.allowLateSubmissions ?? false);
  const showLateCutoff = eff ? eff.lateCutoff : (assignment.lateCutoff ?? null);
  const isOverridden = !!eff && eff.source !== 'base';

  const sameTime = (a?: string | Date | null, b?: string | Date | null) => {
    if (!a || !b) return !a && !b;
    return new Date(a).getTime() === new Date(b).getTime();
  };
  const overrideLabel = eff?.source === 'group-override' ? 'group override' : 'student override';
  const dueOverridden = isOverridden && !sameTime(eff?.dueDate, assignment.dueDate);
  const allowLateOverridden =
    isOverridden && !!eff && eff.allowLateSubmissions !== (assignment.allowLateSubmissions ?? false);
  const cutoffOverridden = isOverridden && !sameTime(eff?.lateCutoff, assignment.lateCutoff);

  const OverrideMark = () => (
    <span className="text-primary ml-1 text-xs font-medium">({overrideLabel})</span>
  );

  return (
    <span className={`block ${className}`}>
      <span>
        <span className="font-semibold">Due:</span>{' '}
        {showDueDate ? formatDateTimeInTimeZone(showDueDate, timezone) : '—'}
        {dueOverridden ? <OverrideMark /> : null}
      </span>
      <span className="text-muted-foreground mx-2">•</span>
      <span>
        <span className="font-semibold">Allow Late:</span> {showAllowLate ? 'Yes' : 'No'}
        {allowLateOverridden ? <OverrideMark /> : null}
      </span>
      <span className="text-muted-foreground mx-2">•</span>
      <span>
        <span className="font-semibold">Late Cutoff:</span>{' '}
        {showAllowLate && showLateCutoff
          ? formatDateTimeInTimeZone(showLateCutoff, timezone)
          : 'Never'}
        {cutoffOverridden ? <OverrideMark /> : null}
      </span>
    </span>
  );
}

export default StudentSchedule;
