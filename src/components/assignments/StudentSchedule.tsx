'use client';

import type React from 'react';
import { CalendarDays, Clock } from 'lucide-react';
import {
  formatDateInTimeZone,
  formatDateTimeInTimeZone,
  formatTimeInTimeZone,
} from '@/lib/date-format';

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
      <div className={`text-muted-foreground px-4 text-sm ${className}`}>Loading assignment...</div>
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

  const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <div className="min-w-0">
      <div className="text-muted-foreground text-xs">{label}</div>
      <div className="text-sm">{children}</div>
    </div>
  );

  // Two cells rather than one divided internally: as direct children of the strip they take
  // its own rules, so every separator on the bar is the same height instead of a short one
  // nested inside a tall one.
  return (
    <>
      <div className={`flex min-w-0 items-center px-4 py-2 xl:flex-auto xl:py-0 ${className}`}>
        <div className="flex items-center gap-2">
          <CalendarDays
            className="text-primary hidden h-8 w-8 shrink-0 xl:block"
            aria-hidden="true"
          />
          <Field label="Due">
            {/* Date and time on separate lines: the strip has the room, and a grader scanning
              for "which day" should not have to read past a timestamp to find it. */}
            {showDueDate ? (
              <>
                <span className="block font-medium">
                  {formatDateInTimeZone(showDueDate, timezone)}
                  {dueOverridden ? <OverrideMark /> : null}
                </span>
                <span className="text-muted-foreground block">
                  {formatTimeInTimeZone(showDueDate, timezone, hour12)}
                </span>
              </>
            ) : (
              <span className="font-medium">—</span>
            )}
          </Field>
        </div>
      </div>

      <div className="flex min-w-0 items-center px-4 py-2 xl:flex-auto xl:py-0">
        <div className="flex items-center gap-2">
          <Clock className="text-primary hidden h-8 w-8 shrink-0 xl:block" aria-hidden="true" />
          <Field label="Late Policy">
            <span className="block">
              <span className="font-medium">Allow Late:</span> {showAllowLate ? 'Yes' : 'No'}
              {allowLateOverridden ? <OverrideMark /> : null}
            </span>
            <span className="block">
              <span className="font-medium">Late Cutoff:</span>{' '}
              {showAllowLate && showLateCutoff
                ? formatDateTimeInTimeZone(showLateCutoff, timezone, hour12)
                : 'Never'}
              {cutoffOverridden ? <OverrideMark /> : null}
            </span>
          </Field>
        </div>
      </div>
    </>
  );
}

export default StudentSchedule;
