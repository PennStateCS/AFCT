'use client';

import type React from 'react';
import { formatShortDateTimeInTimeZone } from '@/lib/date-format';
import { SubmissionMetaItem } from '@/components/assignments/SubmissionMetaItem';

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
  /** The installation's clock preference, so a 24-hour install is not shown 12-hour times. */
  hour12?: boolean;
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
  hour12 = true,
  className = '',
}: StudentScheduleProps) {
  if (loading) {
    return (
      <SubmissionMetaItem label="Due" className={className}>
        <span className="text-muted-foreground">Loading…</span>
      </SubmissionMetaItem>
    );
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
    isOverridden &&
    !!eff &&
    eff.allowLateSubmissions !== (assignment.allowLateSubmissions ?? false);
  const cutoffOverridden = isOverridden && !sameTime(eff?.lateCutoff, assignment.lateCutoff);

  const OverrideMark = () => (
    <span className="text-primary ml-1 text-xs font-medium">({overrideLabel})</span>
  );

  // "Late until Sep 8 · 11:30 PM" says the same thing as "Allow Late: Yes / Late Cutoff: ..."
  // in a quarter of the width, and the two states a grader cares about (there is a cutoff,
  // or late work is not taken) are the label rather than a value to read past.
  const lateLabel = showAllowLate ? 'Late until' : 'Late work';
  const lateValue = !showAllowLate
    ? 'Not accepted'
    : showLateCutoff
      ? formatShortDateTimeInTimeZone(showLateCutoff, timezone, hour12)
      : 'No cutoff';

  return (
    <>
      <SubmissionMetaItem label="Due">
        {showDueDate ? (
          <>
            {formatShortDateTimeInTimeZone(showDueDate, timezone, hour12)}
            {dueOverridden ? <OverrideMark /> : null}
          </>
        ) : (
          '—'
        )}
      </SubmissionMetaItem>

      <SubmissionMetaItem label={lateLabel}>
        {lateValue}
        {allowLateOverridden || cutoffOverridden ? <OverrideMark /> : null}
      </SubmissionMetaItem>
    </>
  );
}

export default StudentSchedule;
