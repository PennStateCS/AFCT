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
  userTimezone: string;
}): LateSubmissionStateResult {
  const {
    incomingAllowLate,
    incomingLateCutoff,
    existingAllowLate,
    existingLateCutoff,
    dueDate,
    userTimezone,
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
      lateCutoff = toDateTimeInTimezone(incomingLateCutoff, userTimezone);
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
