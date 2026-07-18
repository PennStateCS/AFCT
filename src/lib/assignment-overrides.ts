import { toDateTimeInTimezone, toEndOfDayInTimezone } from '@/lib/date-utils';

/** The assignment's base ("Everyone") deadline fields. */
export type OverrideBaseFields = {
  unlockAt: Date | null;
  dueDate: Date;
  lateCutoff: Date | null;
  allowLateSubmissions: boolean;
};

/** Raw override input from the API (dates as course-timezone strings). */
export type OverrideIncoming = {
  unlockAt?: string | null;
  dueDate?: string | null;
  lateCutoff?: string | null;
  allowLateSubmissions?: boolean | null;
};

/** The nullable columns an AssignmentOverride row stores (null = inherit the base). */
export type OverrideFields = {
  unlockAt: Date | null;
  dueDate: Date | null;
  lateCutoff: Date | null;
  allowLateSubmissions: boolean | null;
};

export type ResolveOverrideResult =
  | { ok: true; fields: OverrideFields }
  | { ok: false; message: string };

/**
 * Resolves the columns to store for a student override and validates the resulting
 * effective window (override values falling back to the base).
 *   - `incoming[field] === undefined` keeps the existing value (create: null = inherit)
 *   - an empty string or null means "inherit the base value"
 *   - a value sets the override
 * At least one field must override something (matches the DB `has_change` check), and the
 * effective window must stay ordered: unlockAt <= dueDate <= lateCutoff.
 */
export function resolveOverrideFields(opts: {
  incoming: OverrideIncoming;
  existing: OverrideFields | null;
  base: OverrideBaseFields;
  timezone: string;
  // When the assignment is assigned to specific students, an all-null row is a valid
  // "assigned, inherits base dates" marker, so the has-change requirement is relaxed.
  allowEmpty?: boolean;
}): ResolveOverrideResult {
  const { incoming, existing, base, timezone, allowEmpty } = opts;

  const pickDate = (
    key: 'unlockAt' | 'dueDate' | 'lateCutoff',
    convert: (value: string, tz: string) => Date,
  ): Date | null => {
    if (incoming[key] === undefined) return existing ? existing[key] : null;
    const raw = incoming[key];
    return raw ? convert(raw, timezone) : null;
  };

  const unlockAt = pickDate('unlockAt', toDateTimeInTimezone);
  const dueDate = pickDate('dueDate', toEndOfDayInTimezone);
  const lateCutoff = pickDate('lateCutoff', toDateTimeInTimezone);
  const allowLateSubmissions =
    incoming.allowLateSubmissions === undefined
      ? (existing?.allowLateSubmissions ?? null)
      : incoming.allowLateSubmissions;

  if (
    !allowEmpty &&
    unlockAt === null &&
    dueDate === null &&
    lateCutoff === null &&
    allowLateSubmissions === null
  ) {
    return { ok: false, message: 'An override must change at least one date or the late policy.' };
  }

  // Validate the effective window the student would get (override values, else base).
  const effUnlock = unlockAt ?? base.unlockAt;
  const effDue = dueDate ?? base.dueDate;
  const effAllow = allowLateSubmissions ?? base.allowLateSubmissions;
  const effCutoff = effAllow ? (lateCutoff ?? base.lateCutoff) : null;

  if (effUnlock && effUnlock.getTime() > effDue.getTime()) {
    return { ok: false, message: 'Available-from must be on or before the due date.' };
  }
  if (effCutoff && effCutoff.getTime() < effDue.getTime()) {
    return { ok: false, message: 'Late cutoff must be on or after the due date.' };
  }

  return { ok: true, fields: { unlockAt, dueDate, lateCutoff, allowLateSubmissions } };
}
