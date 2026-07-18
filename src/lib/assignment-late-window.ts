import { toDateTimeInTimezone } from '@/lib/date-utils';

export type LateSubmissionStateResult =
  | { ok: true; allowLateSubmissions: boolean; lateCutoff: Date | null }
  | { ok: false; message: string };

/**
 * Resolves the `{ allowLateSubmissions, lateCutoff }` an assignment update should be
 * saved with, validating the late-submission window against the due date. Shared by
 * the assignment update handlers (PUT/PATCH) so the rules live in one tested place:
 *   - late enabled but no cutoff (neither incoming nor existing) -> error
 *   - a cutoff earlier than the due date -> error
 *   - a cutoff supplied while late submissions are disabled -> error
 * `incomingLateCutoff === undefined` means "field omitted" (keep the existing cutoff);
 * an empty string means "clear it".
 */
export function computeLateSubmissionState(options: {
  incomingAllowLate?: boolean;
  incomingLateCutoff?: string | null;
  existingAllowLate: boolean;
  existingLateCutoff: Date | null;
  dueDate: Date;
  // The course's timezone: the late cutoff wall-time is interpreted in it.
  timezone: string;
}): LateSubmissionStateResult {
  const {
    incomingAllowLate,
    incomingLateCutoff,
    existingAllowLate,
    existingLateCutoff,
    dueDate,
    timezone,
  } = options;

  const allowLateSubmissions =
    typeof incomingAllowLate === 'boolean' ? incomingAllowLate : existingAllowLate;

  let lateCutoff = existingLateCutoff;

  if (allowLateSubmissions) {
    if (incomingLateCutoff === undefined) {
      if (!lateCutoff) {
        return {
          ok: false,
          message: 'Late submission cutoff is required when late submissions are enabled.',
        };
      }
    } else if (!incomingLateCutoff) {
      return {
        ok: false,
        message: 'Late submission cutoff is required when late submissions are enabled.',
      };
    } else {
      lateCutoff = toDateTimeInTimezone(incomingLateCutoff, timezone);
    }

    if (lateCutoff && lateCutoff < dueDate) {
      return {
        ok: false,
        message: 'Late cutoff must be on or after the due date.',
      };
    }
  } else {
    if (incomingLateCutoff && incomingLateCutoff !== null) {
      return {
        ok: false,
        message: 'Late cutoff provided but late submissions are disabled.',
      };
    }
    lateCutoff = null;
  }

  return { ok: true, allowLateSubmissions, lateCutoff };
}

export type UnlockAtResult =
  | { ok: true; unlockAt: Date | null; changed: boolean }
  | { ok: false; message: string };

/**
 * Resolves an assignment's `unlockAt` ("available from"), validating it against the due
 * date. Shared by create and the update handlers.
 *   - `incoming === undefined` means "field omitted" (keep `existing`)
 *   - an empty string or null means "clear it"
 *   - a value is interpreted in the course timezone
 * `unlockAt` must be on or before the due date.
 */
export function resolveUnlockAt(options: {
  incoming?: string | null;
  existing: Date | null;
  dueDate: Date;
  timezone: string;
}): UnlockAtResult {
  const { incoming, existing, dueDate, timezone } = options;

  let unlockAt = existing;
  let changed = false;
  if (incoming !== undefined) {
    changed = true;
    unlockAt = incoming ? toDateTimeInTimezone(incoming, timezone) : null;
  }

  if (unlockAt && unlockAt.getTime() > dueDate.getTime()) {
    return { ok: false, message: 'Available-from must be on or before the due date.' };
  }

  return { ok: true, unlockAt, changed };
}
